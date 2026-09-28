import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { IconButton } from './icon-button';

describe('IconButton', () => {
  it('exposes its aria-label as the accessible name', () => {
    render(<IconButton aria-label="Datei anhängen">+</IconButton>);

    expect(screen.getByRole('button', { name: 'Datei anhängen' })).toHaveAttribute(
      'type',
      'button',
    );
  });

  it('requires an aria-label at compile time', () => {
    // @ts-expect-error: icon-only buttons need an accessible name
    const element = <IconButton>+</IconButton>;

    expect(element).toBeDefined();
  });
});
