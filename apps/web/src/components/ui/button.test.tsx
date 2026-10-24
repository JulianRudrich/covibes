import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from './button';

describe('Button', () => {
  it('defaults to a secondary button of size m that does not submit forms', () => {
    render(<Button>Später</Button>);
    const button = screen.getByRole('button', { name: 'Später' });

    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass(
      'border-border-strong',
      'bg-bg-panel',
      'h-8',
      'text-ui',
      'rounded-full',
    );
  });

  it.each([
    ['primary', ['bg-ink', 'text-on-ink', 'shadow-button-primary']],
    ['secondary', ['border', 'bg-bg-panel', 'shadow-button-secondary']],
    ['ghost', ['bg-transparent', 'hover:bg-bg-subtle']],
  ] as const)('renders the %s variant', (variant, classes) => {
    render(<Button variant={variant}>Aktion</Button>);

    expect(screen.getByRole('button')).toHaveClass(...classes);
  });

  it('renders size s at 28 px, round as well', () => {
    render(<Button size="s">Übernehmen</Button>);

    expect(screen.getByRole('button')).toHaveClass('h-7', 'rounded-full', 'text-small');
  });

  it('lets callers override classes', () => {
    render(<Button className="px-5">Teilen</Button>);
    const button = screen.getByRole('button');

    expect(button).toHaveClass('px-5');
    expect(button).not.toHaveClass('px-3.5');
  });

  it('can be disabled', () => {
    render(<Button disabled>Teilen</Button>);

    expect(screen.getByRole('button')).toBeDisabled();
  });
});
