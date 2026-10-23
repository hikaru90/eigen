/**
 * Browser-mode stub for `$app/state`.
 *
 * `page` is a plain mutable object: specs assign `data`/`url` before render.
 * SvelteKit's reactivity isn't needed for a component mount — `$derived`
 * readers just see whatever the spec last wrote.
 */
export const page = {
  data: {} as Record<string, unknown>,
  url: new URL('http://localhost/'),
  route: { id: null as string | null },
  params: {} as Record<string, string>,
  status: 200,
  form: null,
  error: null,

  get searchParams(): URLSearchParams {
    return this.url.searchParams
  },
}
