import type { ProjectSearchResult, ProjectSearchResults } from '@covibes/shared';
import { Search, X } from 'lucide-react';
import { useRef, useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { IconButton } from '@web/components/ui/icon-button';
import { api } from '@web/lib/api';
import { cn } from '@web/lib/cn';

/** The round magnifier in the chat header that opens the project search (spec 56). */
export function ProjectSearchButton({
  open,
  className,
  ...props
}: Omit<ComponentProps<typeof IconButton>, 'aria-label' | 'children'> & { open: boolean }) {
  const { t } = useTranslation();
  return (
    <IconButton
      aria-label={t('conversation.search')}
      aria-expanded={open}
      className={cn(open && 'bg-wash text-text', className)}
      {...props}
    >
      <Search size={16} strokeWidth={2} aria-hidden="true" />
    </IconButton>
  );
}

/**
 * On a phone the chat has no header (spec 36e): the search starts from a row that looks like the
 * search field it opens.
 */
export function ProjectSearchRow(props: Omit<ComponentProps<'button'>, 'type' | 'children'>) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-expanded={false}
      className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-full bg-bg-subtle px-3.5 text-ui text-text-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      {...props}
    >
      <Search size={15} strokeWidth={2} aria-hidden="true" className="shrink-0" />
      {t('conversation.search')}
    </button>
  );
}

/**
 * Search is explicit and bounded (spec 47): no query is sent on every keystroke. Escape and the
 * close button end it; the chat gives the focus back to what opened it.
 */
export function ProjectSearchPanel({
  projectId,
  onOpen,
  onClose,
  id,
}: {
  projectId: string;
  onOpen: (result: ProjectSearchResult) => void;
  onClose: () => void;
  id?: string;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [results, setResults] = useState<ProjectSearchResult[]>();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  const ready = query.trim().length >= 2;

  return (
    <div
      id={id}
      role="search"
      aria-label={t('conversation.search')}
      className="mx-4 mb-2 flex max-h-[45%] min-h-0 shrink-0 flex-col gap-1.5 rounded-panel bg-bg-subtle p-1.5"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <form
        className="flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          const q = query.trim();
          if (q.length < 2 || q.length > 200) return;
          const current = ++request.current;
          setLoading(true);
          setFailed(false);
          void api<ProjectSearchResults>(
            `/projects/${encodeURIComponent(projectId)}/search?q=${encodeURIComponent(q)}`,
          )
            .then((value) => {
              if (current !== request.current) return;
              setSearched(q);
              setResults(value.results);
            })
            .catch(() => {
              if (current === request.current) setFailed(true);
            })
            .finally(() => {
              if (current === request.current) setLoading(false);
            });
        }}
      >
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full bg-bg-panel px-3.5 text-text-3 inset-ring inset-ring-border focus-within:inset-ring-ink">
          <Search size={15} strokeWidth={2} aria-hidden="true" className="shrink-0" />
          <input
            type="search"
            autoFocus
            minLength={2}
            maxLength={200}
            value={query}
            aria-label={t('conversation.searchLabel')}
            placeholder={t('conversation.searchPlaceholder')}
            className="h-full min-w-0 flex-1 border-0 bg-transparent text-ui text-text outline-none placeholder:text-text-3 [&::-webkit-search-cancel-button]:appearance-none"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </label>
        <Button type="submit" variant="primary" size="s" disabled={loading || !ready}>
          {t('conversation.searchSubmit')}
        </Button>
        <IconButton aria-label={t('conversation.searchClose')} onClick={onClose}>
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </IconButton>
      </form>

      {loading ? (
        <p role="status" className="m-0 px-2.5 pb-1 text-small text-text-3">
          {t('conversation.searching')}
        </p>
      ) : null}
      {failed && !loading ? (
        <p role="alert" className="m-0 px-2.5 pb-1 text-small text-danger">
          {t('conversation.searchFailed')}
        </p>
      ) : null}
      {results && !loading && !failed ? (
        results.length === 0 ? (
          <p role="status" className="m-0 px-2.5 pb-1 text-small text-text-3">
            {t('conversation.noResults', { query: searched })}
          </p>
        ) : (
          <>
            <p role="status" className="m-0 px-2.5 text-meta text-text-3">
              {t('conversation.results', { count: results.length })}
            </p>
            <ul className="m-0 min-h-0 list-none overflow-y-auto p-0">
              {results.map((result) => (
                <li key={`${result.kind}:${result.boardId ?? ''}:${result.id}`}>
                  <button
                    type="button"
                    className="flex w-full cursor-pointer flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-bg-panel focus-visible:bg-bg-panel focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
                    onClick={() => {
                      onOpen(result);
                    }}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="shrink-0 rounded-full bg-bg-panel px-2 py-px text-badge font-semibold text-text-2 inset-ring inset-ring-border">
                        {t(`conversation.kind.${result.kind}`)}
                      </span>
                      <span className="min-w-0 truncate text-ui font-medium text-text">
                        {result.title}
                      </span>
                    </span>
                    {result.snippet ? (
                      <span className="line-clamp-2 text-small text-text-3">{result.snippet}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )
      ) : null}
    </div>
  );
}
