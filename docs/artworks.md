# First 10 artworks

M0 shortlist. Public-domain status was checked against the Art Institute of Chicago API (`is_public_domain`) on 2026-10-14. AIC images and data for public-domain works are CC0.

| # | Artwork | Artist | Year | Source | License | Status |
|---|---|---|---|---|---|---|
| 1 | Paris Street; Rainy Day | Gustave Caillebotte | 1877 | [AIC 20684](https://www.artic.edu/artworks/20684) | CC0 | **In museum.json** |
| 2 | Water Lilies | Claude Monet | 1906 | [AIC 16568](https://www.artic.edu/artworks/16568) | CC0 | **In museum.json** |
| 3 | The Bedroom | Vincent van Gogh | 1889 | [AIC 28560](https://www.artic.edu/artworks/28560) | CC0 | **In museum.json** |
| 4 | A Sunday on La Grande Jatte — 1884 | Georges Seurat | 1884–86 | [AIC 27992](https://www.artic.edu/artworks/27992) | CC0 | Confirmed PD |
| 5 | The Great Wave off Kanagawa | Katsushika Hokusai | c. 1830–33 | [AIC 24645](https://www.artic.edu/artworks/24645) | CC0 | Confirmed PD (woodblock print, small: good for a "works on paper" wall) |
| 6 | Self-Portrait | Vincent van Gogh | 1887 | [AIC 80607](https://www.artic.edu/artworks/80607) | CC0 | Confirmed PD |
| 7 | The Child's Bath | Mary Cassatt | 1893 | [AIC 111442](https://www.artic.edu/artworks/111442) | CC0 | Confirmed PD |
| 8 | Two Sisters (On the Terrace) | Pierre-Auguste Renoir | 1881 | [AIC 14655](https://www.artic.edu/artworks/14655) | CC0 | Confirmed PD |
| 9 | Stacks of Wheat (End of Summer) | Claude Monet | 1890–91 | [AIC 64818](https://www.artic.edu/artworks/64818) | CC0 | Confirmed PD |
| 10 | _open slot_ | | | Met / Rijksmuseum / NGA | | Pick together |

## Not usable publicly

AIC marks these as **not** public domain, so they can't go in the public build. Keep them private if at all ([plan.md, Risks](plan.md#risks)).

- Nighthawks, Edward Hopper (1942)
- American Gothic, Grant Wood (1930)

## Adding one by hand (until the M2 CLI exists)

1. Get metadata: `https://api.artic.edu/api/v1/artworks/<id>?fields=title,artist_title,date_end,dimensions,image_id,is_public_domain`. Check that `is_public_domain` is `true`.
2. Download the preview: `https://www.artic.edu/iiif/2/<image_id>/full/1686,/0/default.jpg` → `content/art/<artwork-id>/preview.jpg`.
3. Add an entry to `content/museum.json`. `dimensionsCm` is **[height, width]**, the same order AIC's `dimensions` string uses.
