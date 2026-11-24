import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FormattedMessage } from '@web/features/chat/formatted-message';

describe('formatted message replies', () => {
  it('renders code and ordered/unordered lists as semantic elements', () => {
    const { container } = render(
      <FormattedMessage
        agents={[]}
        text={'Steps\n1. Read\n2. Decide\n\n- Clear\n- Safe\n\n```ts\nconst safe = true;\n```'}
      />,
    );
    expect(container.querySelector('ol')).toHaveAttribute('start', '1');
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(container.querySelector('pre code')).toHaveTextContent('const safe = true;');
  });
  it('keeps model HTML and code links inert', () => {
    const { container } = render(
      <FormattedMessage
        agents={[]}
        text={
          '<img src=x onerror=alert(1)>\n```html\n<script>alert(1)</script> https://example.com\n```\n`https://example.com`'
        }
      />,
    );
    expect(container.querySelector('img,script,a')).toBeNull();
    expect(container).toHaveTextContent('<script>alert(1)</script>');
  });
});
