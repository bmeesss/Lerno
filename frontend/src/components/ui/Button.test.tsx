import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Button, ButtonLink } from './Button';

describe('Button', () => {
  it('renders children and fires onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Study now</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Study now' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not fire when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Save
      </Button>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('applies variant classes', () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('btn-danger');
  });
});

describe('ButtonLink', () => {
  it('renders a router link with button styling', () => {
    render(
      <MemoryRouter>
        <ButtonLink to="/discover">Explore</ButtonLink>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Explore' });
    expect(link).toHaveAttribute('href', '/discover');
    expect(link).toHaveClass('btn-primary');
  });
});
