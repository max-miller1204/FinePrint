# Ask tab

Select a synced rental, open Ask, pick a phase suggestion or type a question,
then select Ask. Answers show one source control per citation. Tapping a source
reveals its quote inline; the statute link opens the official source. Empty
answers show the legal-aid handoff. Failures retain the input for retry.

History lives in view memory per rental, capped at twenty exchanges; the request
contains at most six previous turns. A rental switch clears the draft and source
expansion. A request returning after a switch stays with its original rental.

Linux cannot build or drive this screen. The macOS `iOS build` workflow compiles
it, including the typed API error handler; `docs/grounded-ask.md` lists TestFlight device checks. No screenshots, iOS e2e
pass, VoiceOver check, or AX5 visual pass is claimed here.

Stress review from source: question 2,000 characters, response twenty sentences,
eight citations per sentence, 6,000-character lease quote, empty result, no synced
rental, offline failure, switching rentals mid-request. Text wraps vertically,
content sits on solid surfaces, source controls have 44-point hit targets, and
no custom animation moves legal text. Run these inputs with AX5 on device.

ask|ios|skeptic|Try a long question and quote with AX5 and VoiceOver, expand sources, ask an unrelated question, go offline then retry, and switch rentals during a request. Check no text truncates and answers never cross rentals.
