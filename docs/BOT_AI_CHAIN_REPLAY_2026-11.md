# Building a chain from an empty board

Tier 10 on standard seed 1006 fired 4 waves on lock 13. The bot could see the active piece and three previews. The local fixed clock ran at 60 ticks per second. Every input below was accepted.

Read boards from the top down. Each letter identifies a locked body. A dot is an empty cell. Row 1 sits on the floor. Each wave shows the board just before its full rows disappear. Columns and rotations use the game’s zero-based piece origin and clockwise quarter turns.

## Lock 1 · L

Column 4, rotation 2. Inputs were rotate flip (tick 13), hardDrop (tick 14).

```text
......A...
....AAA...
```

## Lock 2 · O

Column 7, rotation 0. Inputs were move 1 (tick 28), move 1 (tick 29), move 1 (tick 30), hardDrop (tick 31).

```text
......ABB.
....AAABB.
```

## Lock 3 · J

Column 0, rotation 1. Inputs were move -1 (tick 44), move -1 (tick 45), move -1 (tick 46), move -1 (tick 47), rotate right (tick 48), hardDrop (tick 49).

```text
.C........
.C....ABB.
CC..AAABB.
```

## Lock 4 · I

Column 7, rotation 1. Inputs were move 1 (tick 63), move 1 (tick 64), move 1 (tick 65), rotate right (tick 66), move 1 (tick 67), hardDrop (tick 68).

```text
.........D
.C.......D
.C....ABBD
CC..AAABBD
```

## Lock 5 · S

Column 2, rotation 3. Inputs were move -1 (tick 81), move -1 (tick 82), rotate left (tick 83), hardDrop (tick 84).

```text
.........D
.CE......D
.CEE..ABBD
CC.EAAABBD
```

## Lock 6 · Z

Column 3, rotation 0. Inputs were move -1 (tick 98), hardDrop (tick 99).

```text
.........D
.CEFF....D
.CEEFFABBD
CC.EAAABBD
```

## Lock 7 · T

Column -1, rotation 3. Inputs were move -1 (tick 112), move -1 (tick 113), move -1 (tick 114), move -1 (tick 115), rotate left (tick 116), move -1 (tick 117), hardDrop (tick 118).

```text
G.........
GG.......D
GCEFF....D
.CEEFFABBD
CC.EAAABBD
```

## Lock 8 · Z

Column 1, rotation 0. Inputs were move -1 (tick 131), move -1 (tick 132), move -1 (tick 133), hardDrop (tick 134).

```text
GHH.......
GGHH.....D
GCEFF....D
.CEEFFABBD
CC.EAAABBD
```

## Lock 9 · T

Column 4, rotation 0. Inputs were hardDrop (tick 148).

```text
GHH.......
GGHHIII..D
GCEFFI...D
.CEEFFABBD
CC.EAAABBD
```

## Lock 10 · J

Column 7, rotation 1. Inputs were move 1 (tick 162), move 1 (tick 163), move 1 (tick 164), rotate right (tick 165), hardDrop (tick 166).

Before locking, the bot forecast 4 waves in 3 more pieces.

```text
GHH.....J.
GGHHIII.JD
GCEFFI.JJD
.CEEFFABBD
CC.EAAABBD
```

## Lock 11 · O

Column 3, rotation 0. Inputs were move -1 (tick 179), hardDrop (tick 180).

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

Column 5, rotation 2. Inputs were move 1 (tick 193), rotate flip (tick 194), hardDrop (tick 195).

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

Column 7, rotation 1. Inputs were move 1 (tick 209), move 1 (tick 210), move 1 (tick 211), rotate right (tick 212), move 1 (tick 213), hardDrop (tick 214).

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

At the end of the fire the score was 4719 and cumulative outgoing garbage was 3 rows.

Reproduce the walkthrough from the repository root.

```powershell
node reports/gravity-bot-rebuild/chain-demo.mjs 1006 chain-replay.md
```
