# add-artwork (M2, not built yet)

Planned CLI:

```sh
npm run add-artwork -- <source-url | image-path> --slot <roomId>/<slotId>
```

It will:

1. Fetch the image and metadata from an open-access API (AIC, Met, Rijksmuseum, NGA), or read a local image
2. Refuse anything that isn't public domain unless `--private` is passed
3. Generate a KTX2 preview texture and a Deep Zoom tile pyramid under `content/art/<id>/`
4. Write the artwork entry into `content/museum.json`

Until it exists, follow the manual steps in [docs/artworks.md](../../docs/artworks.md).
