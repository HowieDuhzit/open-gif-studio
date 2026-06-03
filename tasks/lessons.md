# Lessons

- When verifying browser workers, do not trust `npm run build` alone. Confirm production emits the worker asset and run a browser import/export flow against the built server.
- Avoid broad `killall node` cleanup during local verification; capture targeted PIDs and stop only the test servers started for the task.
- When changing public branding assets that keep the same filename, update app references with a cache-busting version and inspect the rendered header size; a detailed SVG can appear unchanged if the browser reuses `/logo.svg` or the mark is too small.
