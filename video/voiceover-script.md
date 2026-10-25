# FinePrint demo: voiceover script

Read at a calm pace, about 150 words a minute. Times are where each line starts in the video.

## Hook (0:00.0)

- **0:00.2** When you move into a Virginia rental, your landlord's damage report counts as correct…
- **0:04.9** …unless you object in writing within five days. Most renters never find out.

## Stakes (0:10.0)

- **0:10.3** Most Blacksburg households rent, and nearly a quarter of renters who move get none of their deposit back.

## Title (0:16.5)

- **0:17.0** FinePrint turns your lease and your phone camera into evidence, and into the deadlines the law already gives you.

## MoveIn (0:22.0)

- **0:22.3** At move-in, FinePrint walks you through each room.
- **0:27.2** It checks every photo on the phone. If it's too dark, it tells you why.
- **0:32.0** Turn on a light, and take it again.
- **0:36.5** Each photo gets a SHA-256 fingerprint the moment you take it, and its location data is removed.
- **0:41.4** The server checks that fingerprint and seals the photo into a signed report.
- **0:46.2** Then FinePrint tracks your deadlines. Your landlord's report is due within five days of move-in…
- **0:51.5** …and you have five days after that to object. It reminds you before time runs out.

## Integrity (0:56.5)

- **0:56.8** Here's why a landlord, a judge, or a caseworker can trust those photos.
- **1:02.2** The server lists every photo in a manifest and signs it with Cloud KMS.
- **1:08.9** Each seal is chained to the one before it. Even a deletion is logged, never hidden.
- **1:13.4** Anyone can check the signatures against our published keys.

## Gemma (1:16.0)

- **1:16.3** Next, the lease. Gemma 4 reads it clause by clause and maps each one to Virginia's rules.
- **1:22.6** Code then checks every quote against the lease, and does the math on rent, fees, and deposits.
- **1:28.6** This lease has five problems, including a deposit of three months' rent. Virginia's limit is two.
- **1:34.7** Each finding puts the lease's exact words next to the law's: a fifteen percent late fee, against a ten percent cap.
- **1:42.1** And it tells you what you can do: ask your landlord to change it before you sign.

## Safety (1:50.5)

- **1:50.7** Some situations need a person, not an app: a lockout, an eviction notice, a threat.
- **1:56.4** Gemma 4 and a keyword backstop both watch for them. In our eval set, every high-stakes case went to legal help.

## Close (2:02.0)

- **2:02.3** FinePrint runs on Google Cloud, and a legal aid group can deploy its own copy with one script.
- **2:09.0** It's open source under Apache-2.0, and built on Gemma 4.

360 words in 2:15.0.
