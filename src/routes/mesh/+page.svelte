<script lang="ts">
  import { resolve } from '$app/paths'
  // /mesh redirects to /mesh/yarn in +page.server.ts; this never renders.
</script>

<a href={resolve('/mesh/yarn')}>Yarn</a>
