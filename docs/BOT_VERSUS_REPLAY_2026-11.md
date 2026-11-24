# A tier 10 chain and one full match

Live bots on the shipped versus rules, seeded, headless on the game's own clock. Repeat them with `node reports/bots-versus-2026-11/replay-fire.mjs 91011 60 10,10 14` and `node reports/bots-versus-2026-11/match-log.mjs 91005 10,10 7`. For the engineers who build on these bots.

## A shelf loaded under fire, 13 lines

The bot keeps the left column empty, roofs it with a square and stands straights on the roof. Seven rows arrive while it builds (two, then five) and lift the towers to row 23, above the visible 20. It builds on. The J that completes the row under the roof lets the straights fall: one line, then four, and five more waves. Thirteen lines, and three rows are left.

```text
Seed 91011, 10,10, 60 s: frags 0-1, pieces/min 160 162
seat 1 (tier 10): 160 pieces, fires by size: 2x7 3x5 4x1 5x3 6x3 13x1
seat 2 (tier 10): 162 pieces, fires by size: 2x7 3x10 4x2 5x2 6x2 8x1 10x2

Largest fire: seat 1, 22.5 s, 13 lines in 7 waves (1+4+2+1+1+1+3). # is the piece just placed, = a row from an opponent, < the top visible row.

-14 I          -13 I +2       -12 L          -11 T          -10 O
15 ..........  15 ..........  15 ..........  15 ..........  15 ..........
14 ..........  14 ..........  14 I.........  14 I.........  14 I.........
13 ..........  13 ..........  13 I.........  13 I.........  13 I.........
12 #.........  12 I.........  12 I.........  12 I.........  12 I.........
11 #.........  11 I.........  11 I.........  11 I.........  11 I.........
10 #.........  10 I.........  10 OO........  10 OO........  10 OO........
 9 #.........   9 I.........   9 OO........   9 OO........   9 OO........
 8 OO........   8 OO........   8 .I........   8 .I........   8 .I........
 7 OO........   7 OO........   7 .I....I...   7 .I#...I...   7 .IT.##I...
 6 .I........   6 .I........   6 .I....I...   6 .I##..I...   6 .ITT##I...
 5 .I........   5 .I....#...   5 .I.###ITTT   5 .I#LLLITTT   5 .ITLLLITTT
 4 .I........   4 .I....#...   4 .OO#OOIZTZ   4 .OOLOOIZTZ   4 .OOLOOIZTZ
 3 .I.....TTT   3 .I....#TTT   3 .OOJOOZZZZ   3 .OOJOOZZZZ   3 .OOJOOZZZZ
 2 .OO.OO.ZTZ   2 .OO.OO#ZTZ   2 =.========   2 =.========   2 =.========
 1 .OOJOOZZZZ   1 .OOJOOZZZZ   1 =.========   1 =.========   1 =.========

-9 O           -8 I           -7 J +5        -6 O           -5 L
24 ..........  24 ..........  24 ..........  24 ..........  24 ..........
23 ..........  23 ..........  23 ..........  23 I.........  23 I.........
22 ..........  22 ..........  22 ..........  22 I.........  22 I.........
21 ..........  21 ..........  21 ..........  21 I.........  21 I.........
20 ..........< 20 ..........< 20 ..........< 20 I.........< 20 I.........<
19 ..........  19 ..........  19 ..........  19 I.........  19 I.........
18 ..........  18 #.........  18 I.........  18 I.........  18 I.........
17 ..........  17 #.........  17 I.........  17 I.........  17 I.........
16 ..........  16 #.........  16 I.........  16 I.........  16 I.........
15 ..........  15 #.........  15 I.........  15 OO........  15 OO...##...
14 I.........  14 I.........  14 I.........  14 OO..##....  14 OO..OO#...
13 I.........  13 I.........  13 I.........  13 .I..##.JJ.  13 .I..OO#JJ.
12 I.........  12 I.........  12 I.........  12 .IT.OOIJOO  12 .IT.OOIJOO
11 I.........  11 I.........  11 I.........  11 .ITTOOIJOO  11 .ITTOOIJOO
10 OO........  10 OO........  10 OO........  10 .ITLLLITTT  10 .ITLLLITTT
 9 OO........   9 OO........   9 OO........   9 .OOLOOIZTZ   9 .OOLOOIZTZ
 8 .I........   8 .I........   8 .I.....##.   8 .OOJOOZZZZ   8 .OOJOOZZZZ
 7 .IT.OOI.##   7 .IT.OOI.OO   7 .IT.OOI#OO   7 =.========   7 =.========
 6 .ITTOOI.##   6 .ITTOOI.OO   6 .ITTOOI#OO   6 =.========   6 =.========
 5 .ITLLLITTT   5 .ITLLLITTT   5 .ITLLLITTT   5 =...======   5 =...======
 4 .OOLOOIZTZ   4 .OOLOOIZTZ   4 .OOLOOIZTZ   4 ======.===   4 ======.===
 3 .OOJOOZZZZ   3 .OOJOOZZZZ   3 .OOJOOZZZZ   3 .=========   3 .=========
 2 =.========   2 =.========   2 =.========   2 .=========   2 .=========
 1 =.========   1 =.========   1 =.========   1 .=========   1 .=========

-4 S           -3 J clr1      -2 S           -1 L           0 J clr13 +1
24 ..........  24 ..........  24 ..........  24 ..........  24 ..........
23 I.........  23 I.........  23 ..........  23 ..........  23 ..........
22 I.........  22 I.........  22 I.........  22 I.........  22 I.........
21 I.........  21 I.........  21 I.........  21 I.........  21 I.........
20 I.........< 20 I.........< 20 I.........< 20 I.........< 20 I.........<
19 I.........  19 I.........  19 I.........  19 I.........  19 I.........
18 I.........  18 I.........  18 I.........  18 I.........  18 I.........
17 I.........  17 I.........  17 I.........  17 I.##......  17 I.LL......
16 I.........  16 I.........  16 I#........  16 IS.#......  16 IS.L......
15 OO.##LL...  15 OO.SSLL...  15 I##.......  15 ISS#......  15 ISSL...#..
14 OO##OOL...  14 OOSSOOL###  14 OO#SSLL...  14 OOSSSLL...  14 OOSSSLL###
13 .I..OOLJJ.  13 .I..OOLJJ#  13 .I..OOLJJJ  13 .I..OOLJJJ  13 .I..OOLJJJ
12 .IT.OOIJOO  12 .IT.OOIJOO  12 .IT.OOIJOO  12 .IT.OOIJOO  12 .IT.OOIJOO
11 .ITTOOIJOO  11 .ITTOOIJOO  11 .ITTOOIJOO  11 .ITTOOIJOO  11 .ITTOOIJOO
10 .ITLLLITTT  10 .ITLLLITTT  10 .ITLLLITTT  10 .ITLLLITTT  10 .ITLLLITTT
 9 .OOLOOIZTZ   9 .OOLOOIZTZ   9 .OOLOOIZTZ   9 .OOLOOIZTZ   9 .OOLOOIZTZ
 8 .OOJOOZZZZ   8 .OOJOOZZZZ   8 .OOJOOZZZZ   8 .OOJOOZZZZ   8 .OOJOOZZZZ
 7 =.========   7 =.========   7 =.========   7 =.========   7 =.========
 6 =.========   6 =.========   6 =.========   6 =.========   6 =.========
 5 =...======   5 =...======   5 =...======   5 =...======   5 =...======
 4 ======.===   4 ======.===   4 ======.===   4 ======.===   4 ======.===
 3 .=========   3 .=========   3 .=========   3 .=========   3 .=========
 2 .=========   2 .=========   2 .=========   2 .=========   2 .=========
 1 .=========   1 .=========   1 .=========   1 .=========   1 .=========

after
 3 ..........
 2 .......J..
 1 ..LLOO.JOO
```

## One free-for-all to seven frags

Fires of six or more lines, rises of six or more rows, and every death.

```text
Seed 91005, tiers 10 v 10, free-for-all to 7: 1-7 in 3:42.2. Stacks are tallest column / spawn columns.
0:16.7  P2 fires 6 lines (2+1+1+1+1), stack after 7/5
0:25.7  P2 fires 8 lines (1+2+3+1+1), stack after 8/5
0:26.1  P1 takes 7 rows, stack 13/11
0:29.6  P2 fires 9 lines (1+1+1+2+1+1+1+1), stack after 6/6
0:29.8  P1 takes 8 rows, stack 16/16
0:32.8  P2 fires 6 lines (1+5), stack after 5/5
0:35.9  P1 OUT, stack 21/21, frags 0-1
0:42.5  P1 fires 6 lines (1+2+3), stack after 5/5
0:47.8  P1 OUT, stack 24/21, frags 0-2
0:55.0  P2 fires 6 lines (1+1+2+1+1), stack after 10/3
0:55.1  P1 fires 7 lines (1+1+4+1), stack after 3/0
0:55.3  P2 takes 6 rows, stack 16/11
1:11.7  P2 OUT, stack 22/21, frags 0-2
1:20.4  P2 fires 7 lines (1+2+3+1), stack after 6/4
1:20.6  P1 takes 6 rows, stack 10/10
1:22.5  P2 fires 6 lines (1+1+1+2+1), stack after 5/5
1:24.2  P1 fires 7 lines (1+5+1), stack after 6/5
1:24.4  P2 takes 6 rows, stack 12/9
1:26.6  P2 fires 8 lines (2+1+5), stack after 4/3
1:26.8  P1 takes 7 rows, stack 16/15
1:37.8  P1 fires 9 lines (1+1+2+1+1+3), stack after 13/10
1:37.9  P2 takes 8 rows, stack 16/16
1:39.4  P2 fires 6 lines (1+2+2+1), stack after 10/10
1:39.6  P1 OUT, stack 24/21, frags 0-3
1:43.0  P2 fires 6 lines (3+1+2), stack after 3/2
1:46.2  P1 fires 6 lines (1+1+4), stack after 6/6
1:47.0  P2 fires 6 lines (1+5), stack after 1/1
1:50.0  P2 3 lines from a rise
1:52.5  P2 fires 7 lines (1+3+3), stack after 3/2
1:52.6  P1 fires 7 lines (1+3+2+1), stack after 4/4
1:52.6  P1 takes 6 rows, stack 10/10
1:52.7  P2 takes 6 rows, stack 10/10
1:57.2  P2 fires 6 lines (1+1+3+1), stack after 11/11
2:05.4  P2 fires 6 lines (1+2+3), stack after 11/10
2:05.6  P1 OUT, stack 23/21, frags 0-4
2:07.5  P2 fires 6 lines (1+1+1+2+1), stack after 5/5
2:10.1  P1 fires 7 lines (1+1+2+3), stack after 4/3
2:10.3  P2 takes 6 rows, stack 11/10
2:23.1  P2 fires 7 lines (1+4+1+1), stack after 3/1
2:23.3  P1 takes 6 rows, stack 24/23
2:23.3  P1 OUT, stack 24/23, frags 0-5
2:30.9  P2 fires 7 lines (2+1+1+1+1+1), stack after 13/3
2:31.1  P1 takes 6 rows, stack 24/15
2:33.2  P1 fires 10 lines (1+1+5+1+1+1), stack after 9/5
2:33.4  P2 takes 9 rows, stack 24/13
2:38.4  P2 fires 8 lines (1+1+5+1), stack after 11/7
2:38.4  P1 takes 7 rows, stack 16/13
2:43.9  P1 fires 10 lines (1+1+5+1+2), stack after 3/3
2:44.3  P2 takes 9 rows, stack 24/15
2:48.7  P2 OUT, stack 22/22, frags 1-5
2:51.3  P1 fires 7 lines (1+3+2+1), stack after 2/1
2:51.5  P2 takes 6 rows, stack 13/7
2:53.7  P2 fires 7 lines (1+4+2), stack after 2/2
2:53.9  P1 3 lines from a rise
2:53.9  P1 takes 6 rows, stack 12/8
3:00.1  P1 fires 6 lines (1+1+3+1), stack after 8/7
3:03.6  P2 fires 6 lines (2+1+3), stack after 2/0
3:04.6  P1 fires 7 lines (1+5+1), stack after 13/10
3:04.8  P2 takes 6 rows, stack 11/8
3:08.3  P2 fires 7 lines (1+5+1), stack after 3/2
3:08.5  P1 takes 7 rows, stack 24/23
3:08.5  P1 OUT, stack 24/23, frags 1-6
3:19.1  P1 fires 6 lines (1+1+2+1+1), stack after 3/1
3:20.2  P2 fires 6 lines (4+1+1), stack after 12/10
3:27.8  P1 fires 8 lines (1+1+1+1+1+1+1+1), stack after 8/1
3:27.9  P2 takes 7 rows, stack 16/14
3:29.5  P2 fires 6 lines (1+2+1+1+1), stack after 8/8
3:38.7  P2 fires 8 lines (1+1+1+1+1+1+2), stack after 5/1
3:39.2  P1 takes 7 rows, stack 22/14
3:42.2  P1 OUT, stack 23/20, frags 1-7
P1 (tier 10): 595 pieces, 161 a minute, 237 rows sent, fires by size 2x22 3x23 4x8 5x13 6x4 7x6 8x1 9x1 10x2
P2 (tier 10): 588 pieces, 159 a minute, 279 rows sent, fires by size 2x17 3x21 4x16 5x8 6x13 7x6 8x4 9x1
```
