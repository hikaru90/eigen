<script lang="ts">
  import { resolve } from '$app/paths'
  import { m } from '$lib/paraglide/messages.js'
  // /memory redirects to /mesh in +page.server.ts (docs/planning/ei-redesign.md,
  // decision 1); this never renders.
</script>

<a href={resolve('/mesh')}>{m.nav_mesh()}</a>
