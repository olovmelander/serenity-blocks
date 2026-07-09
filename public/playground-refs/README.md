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
nothing here is bundled into theme code.
