import type { RequestHandler } from './$types'
import { error } from '@sveltejs/kit'
import { buildMemoryExportZip } from '$lib/server/export/memory-export'

export const GET: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const { filename, bytes } = await buildMemoryExportZip(user.id)

  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer

  return new Response(new Blob([body]), {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  })
}
