import type { ProjectSearchResult, ProjectSearchResults } from '@covibes/shared';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@web/lib/api';

/** Search is explicit and bounded; no query is sent on every keystroke. */
export function ProjectSearch({
  projectId,
  onOpen,
}: {
  projectId: string;
  onOpen: (result: ProjectSearchResult) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProjectSearchResult[]>();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  return (
    <details>
      <summary>{t('conversation.search')}</summary>
      <form
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
              if (current === request.current) setResults(value.results);
            })
            .catch(() => {
              if (current === request.current) setFailed(true);
            })
            .finally(() => {
              if (current === request.current) setLoading(false);
            });
        }}
      >
        <label>
          {t('conversation.searchLabel')}
          <input
            type="search"
            minLength={2}
            maxLength={200}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </label>
        <button type="submit" disabled={loading || query.trim().length < 2}>
          {t('conversation.search')}
        </button>
      </form>
      {loading ? <p role="status">{t('common.loading')}</p> : null}
      {failed ? <p role="alert">{t('conversation.searchFailed')}</p> : null}
      {results && !loading ? (
        <>
          <p role="status">{t('conversation.results', { count: results.length })}</p>
          <ul>
            {results.map((result) => (
              <li key={`${result.kind}:${result.boardId ?? ''}:${result.id}`}>
                <button
                  type="button"
                  onClick={() => {
                    onOpen(result);
                  }}
                >
                  <span>
                    {t(`conversation.kind.${result.kind}`)}: {result.title}
                  </span>
                  <span className="block">{result.snippet}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </details>
  );
}
