# Playground reference images

Drop concept-art / target images here (e.g. nano-banana or Imagen output), then point
the playground at one as the iteration target:

```
http://localhost:5173/playground.html?effect=nebula-dome&ref=/playground-refs/my-target.png&refMode=split
```

You can also just **drag an image file onto the playground window** — it loads as the
reference instantly (no need to save it here first).

Files served from `public/` are available at the site root, so `public/playground-refs/x.png`
is reachable at `/playground-refs/x.png`. This folder is for throwaway iteration targets;
nothing here is bundled into theme code, and the build removes the folder from `dist/`.

**Everything here except this README is local only** (`.gitignore`): reference stills are often
other people's pictures (film frames, game screenshots, photographs) and are never committed.
Keep your own copies outside the repository and drop them in when you need them. A project-owned
generated reference can keep a same-name Markdown provenance sidecar next to it, also local.
