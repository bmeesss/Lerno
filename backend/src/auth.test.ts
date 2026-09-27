import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const app = createApp();

interface AuthBody {
  data: {
    accessToken: string | null;
    refreshToken: string | null;
    user: { id: string; email: string; profile: { displayName: string; role: string } };
    needsEmailConfirmation: boolean;
  };
}

describe('auth flow', () => {
  it('supports signup → me → logout → login → refresh', async () => {
    const email = `sam${Math.floor(Math.random() * 1e6)}@example.com`;

    // Signup
    const signup = await request(app).post('/api/auth/signup').send({
      email,
      password: 'password123',
      displayName: 'Sam de Vries',
    });
    expect(signup.status).toBe(201);
    const session = (signup.body as AuthBody).data;
    expect(session.accessToken).toBeTruthy();
    expect(session.user.email).toBe(email);
    expect(session.user.profile.displayName).toBe('Sam de Vries');
    expect(session.needsEmailConfirmation).toBe(false);

    // Me (authenticated)
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`);
    expect(me.status).toBe(200);
    expect((me.body as AuthBody).data.id).toBe(session.user.id);

    // Me without token → 401
    const anonymous = await request(app).get('/api/auth/me');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('UNAUTHORIZED');

    // Logout
    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${session.accessToken}`);
    expect(logout.status).toBe(204);

    // Login again
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'password123' });
    expect(login.status).toBe(200);
    const session2 = (login.body as AuthBody).data;

    // Refresh token rotation
    const refresh = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: session2.refreshToken });
    expect(refresh.status).toBe(200);
    expect((refresh.body as AuthBody).data.accessToken).toBeTruthy();
  });

  it('rejects duplicate signup with CONFLICT', async () => {
    const email = `dup${Math.floor(Math.random() * 1e6)}@example.com`;
    const first = await request(app)
      .post('/api/auth/signup')
      .send({ email, password: 'password123', displayName: 'Dup' });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/auth/signup')
      .send({ email, password: 'password123', displayName: 'Dup' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');
  });

  it('rejects bad credentials without revealing whether the account exists', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@example.com', password: 'whatever123' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');

    const email = `real${Math.floor(Math.random() * 1e6)}@example.com`;
    await request(app)
      .post('/api/auth/signup')
      .send({ email, password: 'password123', displayName: 'Real' });
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'wrong-password' });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe('Invalid email or password');
  });

  it('validates signup input', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'not-an-email', password: 'short', displayName: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('always accepts password reset requests (no account enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);
  });

  it('updates and reads the profile', async () => {
    const email = `prof${Math.floor(Math.random() * 1e6)}@example.com`;
    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ email, password: 'password123', displayName: 'Before' });
    const token = (signup.body as AuthBody).data.accessToken;

    const update = await request(app)
      .patch('/api/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'After' });
    expect(update.status).toBe(200);
    expect(update.body.data.displayName).toBe('After');

    const publicProfile = await request(app).get(`/api/profile/${signup.body.data.user.id}`);
    expect(publicProfile.status).toBe(200);
    expect(publicProfile.body.data.profile.displayName).toBe('After');
    expect(publicProfile.body.data.stats.publicSetCount).toBe(0);
  });

  it('stores a validated timezone on the private profile only', async () => {
    const email = `tz${Math.floor(Math.random() * 1e6)}@example.com`;
    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ email, password: 'password123', displayName: 'Tz' });
    const token = (signup.body as AuthBody).data.accessToken;
    const userId = signup.body.data.user.id as string;

    const own = await request(app).get('/api/profile').set('Authorization', `Bearer ${token}`);
    expect(own.status).toBe(200);
    expect(own.body.data.timezone).toBe('UTC');

    const bad = await request(app)
      .patch('/api/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ timezone: 'Mars/Olympus' });
    expect(bad.status).toBe(400);

    const good = await request(app)
      .patch('/api/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ timezone: 'Europe/Amsterdam' });
    expect(good.status).toBe(200);
    expect(good.body.data.timezone).toBe('Europe/Amsterdam');

    const again = await request(app).get('/api/profile').set('Authorization', `Bearer ${token}`);
    expect(again.body.data.timezone).toBe('Europe/Amsterdam');

    // Timezone stays private: the public profile never exposes it.
    const pub = await request(app).get(`/api/profile/${userId}`);
    expect(pub.status).toBe(200);
    expect(pub.body.data.profile.timezone).toBeUndefined();
  });
});
