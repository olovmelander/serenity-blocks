# Building a chain from an empty board

Tier 10 on standard seed 1006 fired 4 waves on lock 13. The bot could see the active piece and three previews. The local fixed clock ran at 60 ticks per second. Every input below was accepted.

Read boards from the top down. Each letter identifies a locked body. A dot is an empty cell. Row 1 sits on the floor. Each wave shows the board just before its full rows disappear. Columns and rotations use the game’s zero-based piece origin and clockwise quarter turns.

## Lock 1 · L

Column 4, rotation 2. Inputs were rotate flip (tick 16), hardDrop (tick 20).

```text
......A...
....AAA...
```

## Lock 2 · O

Column 7, rotation 0. Inputs were move 1 (tick 35), move 1 (tick 39), move 1 (tick 43), hardDrop (tick 47).

```text
......ABB.
....AAABB.
```

## Lock 3 · J

Column 0, rotation 1. Inputs were move -1 (tick 62), move -1 (tick 66), move -1 (tick 70), move -1 (tick 74), rotate right (tick 78), hardDrop (tick 82).

```text
.C........
.C....ABB.
CC..AAABB.
```

## Lock 4 · I

Column 7, rotation 1. Inputs were move 1 (tick 98), move 1 (tick 102), move 1 (tick 106), rotate right (tick 110), move 1 (tick 114), hardDrop (tick 118).

```text
.........D
.C.......D
.C....ABBD
CC..AAABBD
```

## Lock 5 · S

Column 2, rotation 3. Inputs were move -1 (tick 131), move -1 (tick 135), rotate left (tick 139), hardDrop (tick 143).

```text
.........D
.CE......D
.CEE..ABBD
CC.EAAABBD
```

## Lock 6 · Z

Column 3, rotation 0. Inputs were move -1 (tick 160), hardDrop (tick 164).

```text
.........D
.CEFF....D
.CEEFFABBD
CC.EAAABBD
```

## Lock 7 · T

Column -1, rotation 3. Inputs were move -1 (tick 178), move -1 (tick 182), move -1 (tick 186), move -1 (tick 190), rotate left (tick 194), move -1 (tick 198), hardDrop (tick 202).

```text
G.........
GG.......D
GCEFF....D
.CEEFFABBD
CC.EAAABBD
```

## Lock 8 · Z

Column 1, rotation 0. Inputs were move -1 (tick 216), move -1 (tick 220), move -1 (tick 224), hardDrop (tick 228).

```text
GHH.......
GGHH.....D
GCEFF....D
.CEEFFABBD
CC.EAAABBD
```

## Lock 9 · T

Column 4, rotation 0. Inputs were hardDrop (tick 243).

```text
GHH.......
GGHHIII..D
GCEFFI...D
.CEEFFABBD
CC.EAAABBD
```

## Lock 10 · J

Column 7, rotation 1. Inputs were move 1 (tick 260), move 1 (tick 264), move 1 (tick 268), rotate right (tick 272), hardDrop (tick 276).

Before locking, the bot forecast 4 waves in 3 more pieces.

```text
GHH.....J.
GGHHIII.JD
GCEFFI.JJD
.CEEFFABBD
CC.EAAABBD
```

## Lock 11 · O

Column 3, rotation 0. Inputs were move -1 (tick 290), hardDrop (tick 294).

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

Column 5, rotation 2. Inputs were move 1 (tick 309), rotate flip (tick 313), hardDrop (tick 317).

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

Column 7, rotation 1. Inputs were move 1 (tick 334), move 1 (tick 338), move 1 (tick 342), rotate right (tick 346), move 1 (tick 350), hardDrop (tick 354).

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

At the end of the fire the score was 4647 and cumulative outgoing garbage was 3 rows.

Reproduce the walkthrough from the repository root.

```powershell
node reports/gravity-bot-rebuild/chain-demo.mjs 1006 chain-replay.md
```
