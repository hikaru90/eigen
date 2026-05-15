import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { dev } from '$app/environment';

export const POST: RequestHandler = async () => {
  // Only allow in dev mode
  if (!dev) {
    return json({ error: 'Eval endpoint only available in dev mode' }, { status: 403 });
  }

  return new Promise((resolveResponse) => {
    const scriptPath = resolve(process.cwd(), 'evals/layers/run-all.ts');
    const proc = spawn('npx', ['tsx', scriptPath], {
      cwd: process.cwd(),
      stdio: 'pipe'
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log(data.toString());
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error(data.toString());
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolveResponse(json({ 
          success: true, 
          message: 'Evaluation completed',
          output: stdout.slice(-500) // Last 500 chars
        }));
      } else {
        resolveResponse(json({ 
          success: false, 
          error: `Process exited with code ${code}`,
          stderr: stderr.slice(-500)
        }, { status: 500 }));
      }
    });
  });
};
