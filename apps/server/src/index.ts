import { serve } from '@hono/node-server';
import { EnvValidationError } from '@covibes/shared';

import { createApp } from '@server/app';
import { loadServerEnv, type ServerEnv } from '@server/env';

function readEnvOrExit(): ServerEnv {
  try {
    return loadServerEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

const env = readEnvOrExit();

serve({ fetch: createApp().fetch, port: env.PORT }, (info) => {
  console.log(`Covibes server listening on http://localhost:${String(info.port)}`);
});
