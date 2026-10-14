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

## In the museum from Wikimedia Commons

Checked 2026-10-14. Images are 2D reproductions of public-domain paintings. Each file's license is recorded as Commons states it, and the label shows it.

**Hilma af Klint, The Swan (Group IX/SUW), 1914–15, in `swan-room`.** The series has 24 paintings. These 12 are the ones with clean, distinctly numbered scans on Commons:

| No. | Dimensions (cm, h × w) | License on Commons |
|---|---|---|
| 1 | 150 × 150 | Public domain |
| 7, 9, 10, 14, 18 | 150 × 150 (approx.) | Public domain |
| 12 | 151.5 × 151 | Public domain |
| 13 | 148.5 × 151 | Public domain |
| 17 | 150.5 × 151 | Public domain |
| 22 | 150 × 150 (approx.) | CC0 |
| 16, 23 | 150 × 150 (approx.) | CC BY-SA 4.0 (low-res, 900 px; replace with better PD scans when found) |

Sizes for Nos. 1, 12, 13 and 17 come from exhibition listings (AGNSW, Guggenheim Bilbao, Kunstsammlung NRW). The rest of the series is about 150 cm square; replace "approx." with catalogue figures from the Hilma af Klint Foundation when we have them.

**In `dark-room`:**

| Artwork | Artist | Date | Dimensions (cm) | Source | License |
|---|---|---|---|---|---|
| Saturn Devouring His Son | Francisco de Goya | 1819–1823 | 143.5 × 81.4 | [Commons](https://commons.wikimedia.org/wiki/File:Francisco_de_Goya,_Saturno_devorando_a_su_hijo_(1819-1823).jpg) | Public domain |
| Judith Beheading Holofernes | Caravaggio | c. 1599 | 145 × 195 | [Commons](https://commons.wikimedia.org/wiki/File:Caravaggio_-_Giuditta_e_Oloferne_(ca._1599).jpg) | Public domain |

| Judith Slaying Holofernes | Artemisia Gentileschi | c. 1620 | 199 × 162.5 | [Commons](https://commons.wikimedia.org/wiki/File:Artemisia_Gentileschi_-_Giuditta_decapita_Oloferne_-_Google_Art_Project.jpg) | Public domain |

Dimensions come from Wikidata (Q1150997, Q2470123, Q3769169). Artemisia's is the Uffizi version (c. 1620). The earlier Naples version is 158.8 × 125.4 cm.

## Armor Court (Cleveland Museum of Art, all CC0)

Data and images come from the [CMA Open Access API](https://openaccess-api.clevelandart.org/).

- **Tapestries:** *The Story of Dido and Aeneas*, 1915.79.1–8. Designed by Giovanni Francesco Romanelli, woven by Michael Wauters, 1679. Sizes come from the API.
- **Armor** (`sculptures` in museum.json): 1964.88 *Armor for Man and Horse with Völs-Colonna Arms*, 1916.1723 crossbow of Augustus I, 1916.891 burgonet, 1916.1521 hussar breastplate, 1926.54 Corinthian helmet. All five have CC0 3D scans on Sketchfab (`sketchfab_id` in the API). Downloading needs a Sketchfab login, so photo cards stand in for now.
  - Approximate sizes: the horse armor is set to 270 × 90 × 280 cm because the API lists no dimensions. The helmet and breastplate depths are estimates.
- Other suits in the court, such as the Cuirassier's armor and the Field Armor in Maximilian Style, have no 3D scans, so they're left out.

## Excluded

- Eldzier Cortor, *L'Abattoir (The Slaughterhouse)*, MoMA. Cortor died in 2015, so the work is under copyright. The public build is public-domain only.

## Not usable publicly

AIC marks these as **not** public domain, so they can't go in the public build. Keep them private if at all ([plan.md, Risks](plan.md#risks)).

- Nighthawks, Edward Hopper (1942)
- American Gothic, Grant Wood (1930)

## Adding one by hand (until the M2 CLI exists)

1. Get metadata: `https://api.artic.edu/api/v1/artworks/<id>?fields=title,artist_title,date_end,dimensions,image_id,is_public_domain`. Check that `is_public_domain` is `true`.
2. Download the preview: `https://www.artic.edu/iiif/2/<image_id>/full/1686,/0/default.jpg` → `content/art/<artwork-id>/preview.jpg`.
3. Add an entry to `content/museum.json`. `dimensionsCm` is **[height, width]**, the same order AIC's `dimensions` string uses.
