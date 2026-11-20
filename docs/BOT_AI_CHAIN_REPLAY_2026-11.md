# Building a chain from an empty board

Tier 10 on standard seed 1006 fired 4 waves on lock 13. The bot could see the active piece and three previews. The local fixed clock ran at 60 ticks per second. Every input below was accepted.

Read boards from the top down. Each letter identifies a locked body. A dot is an empty cell. Row 1 sits on the floor. Each wave shows the board just before its full rows disappear. Columns and rotations use the game’s zero-based piece origin and clockwise quarter turns.

## Lock 1 · L

Column 4, rotation 2. Inputs were rotate flip (tick 16), hardDrop (tick 21).

```text
......A...
....AAA...
```

## Lock 2 · O

Column 7, rotation 0. Inputs were move 1 (tick 36), move 1 (tick 41), move 1 (tick 46), hardDrop (tick 51).

```text
......ABB.
....AAABB.
```

## Lock 3 · J

Column 0, rotation 1. Inputs were move -1 (tick 66), move -1 (tick 71), move -1 (tick 76), move -1 (tick 81), rotate right (tick 86), hardDrop (tick 91).

```text
.C........
.C....ABB.
CC..AAABB.
```

## Lock 4 · I

Column 7, rotation 1. Inputs were move 1 (tick 107), move 1 (tick 112), move 1 (tick 117), rotate right (tick 122), move 1 (tick 127), hardDrop (tick 132).

```text
.........D
.C.......D
.C....ABBD
CC..AAABBD
```

## Lock 5 · S

Column 2, rotation 3. Inputs were move -1 (tick 145), move -1 (tick 150), rotate left (tick 155), hardDrop (tick 160).

```text
.........D
.CE......D
.CEE..ABBD
CC.EAAABBD
```

## Lock 6 · Z

Column 3, rotation 0. Inputs were move -1 (tick 177), hardDrop (tick 182).

```text
.........D
.CEFF....D
.CEEFFABBD
CC.EAAABBD
```

## Lock 7 · T

Column -1, rotation 3. Inputs were move -1 (tick 196), move -1 (tick 201), move -1 (tick 206), move -1 (tick 211), rotate left (tick 216), move -1 (tick 221), hardDrop (tick 226).

```text
G.........
GG.......D
GCEFF....D
.CEEFFABBD
CC.EAAABBD
```

## Lock 8 · Z

Column 1, rotation 0. Inputs were move -1 (tick 240), move -1 (tick 245), move -1 (tick 250), hardDrop (tick 255).

```text
GHH.......
GGHH.....D
GCEFF....D
.CEEFFABBD
CC.EAAABBD
```

## Lock 9 · T

Column 4, rotation 0. Inputs were hardDrop (tick 270).

```text
GHH.......
GGHHIII..D
GCEFFI...D
.CEEFFABBD
CC.EAAABBD
```

## Lock 10 · J

Column 7, rotation 1. Inputs were move 1 (tick 287), move 1 (tick 292), move 1 (tick 297), rotate right (tick 302), hardDrop (tick 307).

Before locking, the bot forecast 4 waves in 3 more pieces.

```text
GHH.....J.
GGHHIII.JD
GCEFFI.JJD
.CEEFFABBD
CC.EAAABBD
```

## Lock 11 · O

Column 3, rotation 0. Inputs were move -1 (tick 321), hardDrop (tick 326).

Before locking, the bot forecast 4 waves in 2 more pieces.

```text
...KK.....
GHHKK...J.
GGHHIII.JD
GCEFFI.JJD
.CEEFFABBD
CC.EAAABBD
```

## Lock 12 · L

Column 5, rotation 2. Inputs were move 1 (tick 341), rotate flip (tick 346), hardDrop (tick 351).

Before locking, the bot forecast 4 waves in 1 more piece.

```text
...KK..L..
GHHKKLLLJ.
GGHHIII.JD
GCEFFI.JJD
.CEEFFABBD
CC.EAAABBD
```

## Lock 13 · I

Column 7, rotation 1. Inputs were move 1 (tick 368), move 1 (tick 373), move 1 (tick 378), rotate right (tick 383), move 1 (tick 388), hardDrop (tick 393).

Wave 1 clears row 5.

```text
.........M
.........M
...KK..L.M
GHHKKLLLJM
GGHHIII.JD
GCEFFI.JJD
.CEEFFABBD
CC.EAAABBD
```

Wave 2 clears row 4.

```text
.........M
.........M
...KK....M
GGHHIIILJD
GCEFFI.JJD
.CEEFFABBD
CC.EAAABBD
```

Wave 3 clears row 2.

```text
.........M
.........M
...KK....M
.CEFFI.JJD
GCEEFFABBD
CC.EAAABBD
```

Wave 4 clears row 1.

```text
.........M
.........M
...KK....M
.C.FFI.JJD
CCEEAAABBD
```

After the fragments settle

```text
.........M
.........M
...KK....M
.C.FFI.JJD
```

At the end of the fire the score was 4628 and cumulative outgoing garbage was 3 rows.

Reproduce the walkthrough from the repository root.

```powershell
node reports/gravity-bot-rebuild/chain-demo.mjs 1006 chain-replay.md
```
