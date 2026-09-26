# Doro animation sources

Repository: https://github.com/waterfeet/DoroPet
Pinned commit: b0283186889993dcb4284dc5a4b15c5f05719d03
Source folder: Qtpet/doroimg
Retrieved: 2026-09-26

| Local source | Upstream file | Git blob |
| --- | --- | --- |
| walk.gif | load.gif | dad4337d424a58366b242d06e759216dc0428eb9 |
| idle.gif | dorolay.gif | 8ef257922192f1c954b27d875370b62905366279 |
| special.gif | dorohappy.gif | 524f6c4d0449590df01aee3edf3ea9a5707ec1d1 |
| click.gif | dorohello.gif | cd2c260922dae89c4634a4f37a9993ecb7a556d7 |

The source repository publishes Apache-2.0; its license is preserved in LICENSE.txt.
The software license does not establish ownership of the depicted Doro character.

Local modifications (scripts/normalize-pet-assets.py): remove alpha noise below 20,
crop the union of visible frames, fit each clip into a transparent 256 x 256 canvas
with 12px padding, and encode animated WebP retaining frame timings and looping.
PNG files are the corresponding static first frames; icon.png is a 48px derivative.
bounds.json stores visible alpha union bounds. Original downloads remain unchanged.
