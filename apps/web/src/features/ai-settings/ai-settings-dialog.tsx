import {
  AI_PROVIDERS,
  type AiProvider,
  type WorkspaceAiSettings,
  type WorkspaceSummary,
} from '@covibes/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { Notice } from '@web/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTrigger,
} from '@web/components/ui/dialog';
import { Input, Label } from '@web/components/ui/input';
import { api } from '@web/lib/api';

const workspacePath = (id: string) => `/workspaces/${encodeURIComponent(id)}/ai`;

/** Workspace owners can manage funding without exposing stored credentials. */
export function AiSettingsDialog() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const workspaces = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => api<WorkspaceSummary[]>('/workspaces'),
    enabled: open,
  });
  const owners = (workspaces.data ?? []).filter((workspace) => workspace.role === 'owner');
  const workspace = owners.find((item) => item.id === selected) ?? owners[0];
  const settings = useQuery({
    queryKey: ['workspace-ai', workspace?.id],
    queryFn: () => api<WorkspaceAiSettings>(workspacePath(workspace?.id ?? '')),
    enabled: open && workspace !== undefined,
  });
  const money = new Intl.NumberFormat(i18n.resolvedLanguage, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });

  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) setSelected('');
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">{t('aiSettings.open')}</Button>
      </DialogTrigger>
      <DialogContent
        title={t('aiSettings.title')}
        description={t('aiSettings.description')}
        className="max-h-[calc(100dvh-32px)] overflow-y-auto"
      >
        {workspaces.isPending ? <p>{t('common.loading')}</p> : null}
        {workspaces.isError ? <Notice tone="danger">{t('aiSettings.loadError')}</Notice> : null}
        {workspaces.isSuccess && owners.length === 0 ? (
          <p className="text-small text-text-3">{t('aiSettings.noWorkspace')}</p>
        ) : null}
        {workspace ? (
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="ai-workspace">{t('aiSettings.workspace')}</Label>
              <select
                id="ai-workspace"
                value={workspace.id}
                onChange={(event) => {
                  setSelected(event.target.value);
                }}
                className="h-9 w-full rounded-md border border-border-strong bg-bg-panel px-3 text-ui text-text"
              >
                {owners.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            {settings.isPending ? <p>{t('common.loading')}</p> : null}
            {settings.isError ? <Notice tone="danger">{t('aiSettings.loadError')}</Notice> : null}
            {settings.data ? (
              <>
                <p className="m-0 text-small text-text-3">
                  {t('aiSettings.spending', {
                    month: settings.data.month,
                    workspace: money.format(settings.data.spending.workspaceUsd),
                    instance: money.format(settings.data.spending.instanceUsd),
                  })}
                </p>
                {!settings.data.canStoreKeys ? (
                  <Notice>{t('aiSettings.unavailable')}</Notice>
                ) : null}
                {AI_PROVIDERS.map((provider) => (
                  <ProviderKey
                    key={`${workspace.id}-${provider}`}
                    workspaceId={workspace.id}
                    provider={provider}
                    configured={settings.data.configured.includes(provider)}
                    canStore={settings.data.canStoreKeys}
                  />
                ))}
              </>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">{t('common.close')}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProviderKey({
  workspaceId,
  provider,
  configured,
  canStore,
}: {
  workspaceId: string;
  provider: AiProvider;
  configured: boolean;
  canStore: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [key, setKey] = useState('');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function update(value: string | null) {
    setPending(true);
    setFailed(false);
    try {
      await api<undefined>(
        `${workspacePath(workspaceId)}/${provider}`,
        value === null
          ? { method: 'DELETE' }
          : { method: 'PUT', body: JSON.stringify({ key: value }) },
      );
      setKey('');
      await queryClient.invalidateQueries({ queryKey: ['workspace-ai', workspaceId] });
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (key.trim()) void update(key.trim());
  }
  const name = provider === 'anthropic' ? 'Anthropic' : 'OpenAI';
  return (
    <form className="grid gap-2 border-t border-border pt-3" onSubmit={submit}>
      <div className="flex justify-between gap-2">
        <Label htmlFor={`ai-key-${provider}`}>{name}</Label>
        <span className="text-small text-text-3">
          {configured ? t('aiSettings.configured') : t('aiSettings.notConfigured')}
        </span>
      </div>
      <Input
        id={`ai-key-${provider}`}
        type="password"
        autoComplete="off"
        value={key}
        onChange={(event) => {
          setKey(event.target.value);
        }}
        placeholder={t('aiSettings.keyPlaceholder')}
        disabled={!canStore || pending}
      />
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" disabled={!canStore || pending || !key.trim()}>
          {configured ? t('aiSettings.replace') : t('aiSettings.save')}
        </Button>
        {configured ? (
          <Button
            variant="secondary"
            disabled={!canStore || pending}
            onClick={() => {
              void update(null);
            }}
          >
            {t('aiSettings.remove')}
          </Button>
        ) : null}
      </div>
      {failed ? <Notice tone="danger">{t('aiSettings.saveError')}</Notice> : null}
    </form>
  );
}
