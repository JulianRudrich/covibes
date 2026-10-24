import type { AgentKey } from '@covibes/shared';
import { useTranslation } from 'react-i18next';

import { Logo } from '@web/components/logo';
import { CATALOG_MARKS } from '@web/components/ui/agent-marks';
import { Avatar } from '@web/components/ui/avatar';
import { aiRing } from '@web/lib/styles';

/** The four agents of the studio handoff, at the foot of the scene. */
const SCENE_AGENTS: readonly AgentKey[] = ['moderator', 'backend', 'critic', 'data'];

const MODERATOR = { look: 'moderator', color: null } as const;

/**
 * The left side of the login (spec 36c, draft E): a still piece of a canvas with the headline. It
 * shows what Covibes is at a glance, a person's idea, the moderator's decision, a note and a short
 * exchange with the critic, and is decoration for screen readers apart from its text.
 */
export function LoginScene() {
  const { t } = useTranslation();
  return (
    <section
      aria-labelledby="login-hero"
      className="relative m-3 mr-0 min-h-[720px] overflow-hidden rounded-frame bg-bg-canvas shadow-panel"
    >
      {/* The dot grid of the canvas. */}
      <svg aria-hidden="true" className="absolute inset-0 size-full">
        <defs>
          <pattern id="login-dots" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="12" cy="12" r="1.2" fill="var(--color-canvas-dot)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#login-dots)" />
      </svg>

      <div className="absolute top-12 left-14 flex items-center gap-2.5">
        <Logo className="size-6" />
        <span className="font-display text-[20px] font-bold tracking-[-0.025em]">
          {t('common.wordmark')}
        </span>
      </div>

      <div className="absolute top-[150px] left-14 w-[560px] max-w-[calc(100%-112px)]">
        <h1
          id="login-hero"
          className="m-0 font-display text-[52px] leading-[1.04] font-semibold tracking-[-0.035em] whitespace-pre-line"
        >
          {t('auth.hero.title')}
        </h1>
        <p className="mt-[18px] mb-0 max-w-[460px] text-[16px] leading-[1.55] text-text-2">
          {t('auth.hero.text')}
        </p>
      </div>

      <div aria-hidden="true" className="absolute top-[460px] left-14 h-[380px] w-[720px]">
        <svg width="720" height="380" className="absolute inset-0">
          <path
            d="M200 70 C 270 70 270 170 340 170"
            fill="none"
            stroke="var(--color-edge)"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M520 170 C 580 170 580 80 640 80"
            fill="none"
            stroke="var(--color-agent-moderator)"
            strokeWidth="2.25"
            strokeLinecap="round"
          />
        </svg>

        <div className="absolute top-6 left-5 flex h-[92px] w-[180px] -rotate-2 flex-col justify-between rounded-panel bg-bg-panel px-3.5 py-3 shadow-block">
          <div className="text-title font-semibold">{t('auth.hero.idea')}</div>
          <div className="flex items-center gap-1.5 text-status text-text-3">
            <Avatar kind="human" size={20} label={t('auth.hero.person')} initials="A" />
            {t('auth.hero.person')}
          </div>
        </div>

        <div
          className="absolute top-[118px] left-[340px] flex h-[104px] w-[180px] flex-col justify-between rounded-panel bg-agent-moderator-tint px-3.5 py-3"
          style={{ boxShadow: aiRing(MODERATOR) }}
        >
          <div>
            <div className="text-title font-semibold">{t('auth.hero.decision')}</div>
            <div className="text-status text-agent-moderator-dark">{t('auth.hero.comparison')}</div>
          </div>
          <div className="flex items-center gap-1.5 text-status font-semibold text-agent-moderator-dark">
            <Avatar
              kind="agent"
              agent="moderator"
              mark={CATALOG_MARKS.moderator}
              size={20}
              label={t('agents.moderator')}
            />
            {t('agents.moderator')}
          </div>
        </div>

        <div className="absolute top-[30px] left-[600px] size-28 rotate-3 rounded-[6px_6px_22px_6px] bg-note p-3.5 font-display text-[15px] font-semibold text-note-text shadow-note">
          {t('auth.hero.note')}
        </div>

        <div className="absolute top-[230px] left-[60px] flex w-[260px] flex-col gap-2">
          <div className="self-start rounded-[16px] rounded-bl-[5px] bg-bg-panel px-[13px] py-[9px] text-ui shadow-block">
            {t('auth.hero.question')}
          </div>
          <div className="flex items-end gap-2 self-start">
            <Avatar
              kind="agent"
              agent="critic"
              mark={CATALOG_MARKS.critic}
              size={26}
              label={t('agents.critic')}
            />
            <div className="rounded-[16px] rounded-bl-[5px] bg-agent-critic-tint px-[13px] py-[9px] text-ui">
              {t('auth.hero.objection')}
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-10 left-14 flex items-center gap-2.5 text-small text-text-3">
        <span aria-hidden="true" className="flex">
          {SCENE_AGENTS.map((key, index) => (
            <Avatar
              key={key}
              kind="agent"
              agent={key}
              mark={CATALOG_MARKS[key]}
              size={24}
              label={t(`agents.${key}`)}
              className={index === 0 ? 'ring-2 ring-bg-canvas' : '-ml-[5px] ring-2 ring-bg-canvas'}
            />
          ))}
        </span>
        {t('auth.hero.agents')}
      </div>
    </section>
  );
}
