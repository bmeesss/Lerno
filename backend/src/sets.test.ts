import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const app = createApp();

async function signup(name: string): Promise<{ token: string; userId: string }> {
  const email = `${name}${Math.floor(Math.random() * 1e6)}@example.com`;
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'password123', displayName: name });
  return {
    token: res.body.data.accessToken as string,
    userId: res.body.data.user.id as string,
  };
}

describe('subjects', () => {
  it('creates, lists, renames and deletes subjects', async () => {
    const { token } = await signup('SubjectOwner');

    const create = await request(app)
      .post('/api/subjects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Biology' });
    expect(create.status).toBe(201);
    expect(create.body.data.name).toBe('Biology');
    expect(create.body.data.setCount).toBe(0);

    const list = await request(app).get('/api/subjects').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const subjectId = create.body.data.id as string;
    const rename = await request(app)
      .patch(`/api/subjects/${subjectId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Biology 4 havo' });
    expect(rename.status).toBe(200);
    expect(rename.body.data.name).toBe('Biology 4 havo');

    const del = await request(app)
      .delete(`/api/subjects/${subjectId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(204);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/subjects');
    expect(res.status).toBe(401);
  });
});

describe('study sets + cards', () => {
  it('runs the full set lifecycle with authorization checks', async () => {
    const owner = await signup('Owner');
    const other = await signup('Other');

    // Subject + set with initial cards
    const subject = await request(app)
      .post('/api/subjects')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'History' });

    const create = await request(app)
      .post('/api/sets')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        title: 'French Revolution',
        subjectId: subject.body.data.id,
        level: 'havo 4',
        description: 'Key dates and figures',
        visibility: 'private',
        tags: ['history', 'france'],
        cards: [
          { question: 'When did the French Revolution start?', answer: '1789' },
          { question: 'Who was king of France in 1789?', answer: 'Louis XVI' },
        ],
      });
    expect(create.status).toBe(201);
    const setId = create.body.data.id as string;
    expect(create.body.data.cardCount).toBe(2);
    expect(create.body.data.subjectName).toBe('History');
    expect(create.body.data.isOwner).toBe(true);

    // Owner can read a private set
    const ownerDetail = await request(app)
      .get(`/api/sets/${setId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(ownerDetail.status).toBe(200);
    expect(ownerDetail.body.data.cards).toHaveLength(2);

    // Private set is hidden from guests and other users (404, not 403)
    const guestDetail = await request(app).get(`/api/sets/${setId}`);
    expect(guestDetail.status).toBe(404);
    const otherDetail = await request(app)
      .get(`/api/sets/${setId}`)
      .set('Authorization', `Bearer ${other.token}`);
    expect(otherDetail.status).toBe(404);

    // Non-owner cannot update or delete
    const foreignUpdate = await request(app)
      .patch(`/api/sets/${setId}`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({ title: 'Hacked' });
    expect(foreignUpdate.status).toBe(404);
    const foreignDelete = await request(app)
      .delete(`/api/sets/${setId}`)
      .set('Authorization', `Bearer ${other.token}`);
    expect(foreignDelete.status).toBe(404);

    // Make it public → guests can study it
    const publish = await request(app)
      .patch(`/api/sets/${setId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ visibility: 'public' });
    expect(publish.status).toBe(200);
    expect(publish.body.data.visibility).toBe('public');

    const publicDetail = await request(app).get(`/api/sets/${setId}`);
    expect(publicDetail.status).toBe(200);
    expect(publicDetail.body.data.isOwner).toBe(false);
    expect(publicDetail.body.data.cards).toHaveLength(2);

    // Cards: guest can read, only owner can write
    const guestCards = await request(app).get(`/api/sets/${setId}/cards`);
    expect(guestCards.status).toBe(200);
    expect(guestCards.body.data).toHaveLength(2);

    const addCard = await request(app)
      .post(`/api/sets/${setId}/cards`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        cards: [{ question: 'What is the Bastille?', answer: 'A prison fortress in Paris' }],
      });
    expect(addCard.status).toBe(201);
    expect(addCard.body.data).toHaveLength(1);
    const cardId = addCard.body.data[0].id as string;

    const foreignCard = await request(app)
      .post(`/api/sets/${setId}/cards`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({ cards: [{ question: 'x?', answer: 'y' }] });
    expect(foreignCard.status).toBe(404);

    const editCard = await request(app)
      .patch(`/api/sets/${setId}/cards/${cardId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ answer: 'A fortress-prison in Paris, stormed on 14 July 1789' });
    expect(editCard.status).toBe(200);
    expect(editCard.body.data.answer).toContain('1789');

    const deleteCard = await request(app)
      .delete(`/api/sets/${setId}/cards/${cardId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(deleteCard.status).toBe(204);

    // Deleting the set removes everything
    const deleteSet = await request(app)
      .delete(`/api/sets/${setId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(deleteSet.status).toBe(204);
    const gone = await request(app).get(`/api/sets/${setId}`);
    expect(gone.status).toBe(404);
  });

  it('validates set input', async () => {
    const { token } = await signup('Validator');
    const res = await request(app)
      .post('/api/sets')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: '', visibility: 'semi-public' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('keeps subject names in sync when renaming', async () => {
    const { token } = await signup('Syncer');
    const subject = await request(app)
      .post('/api/subjects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Math' });
    const set = await request(app)
      .post('/api/sets')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Algebra basics', subjectId: subject.body.data.id });
    expect(set.body.data.subjectName).toBe('Math');

    await request(app)
      .patch(`/api/subjects/${subject.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Wiskunde' });

    const detail = await request(app)
      .get(`/api/sets/${set.body.data.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.body.data.subjectName).toBe('Wiskunde');
  });

  it('rejects assigning someone else subject to a set', async () => {
    const owner = await signup('SubjectOwner2');
    const thief = await signup('Thief');
    const subject = await request(app)
      .post('/api/subjects')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Private topic' });

    const res = await request(app)
      .post('/api/sets')
      .set('Authorization', `Bearer ${thief.token}`)
      .send({ title: 'Sneaky', subjectId: subject.body.data.id });
    expect(res.status).toBe(404);
  });
});
