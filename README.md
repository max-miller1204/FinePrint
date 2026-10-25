# FinePrint

> TODO: one-line pitch (#48)

## Overview

TODO (#48)

## Models and licenses

TODO: exact model IDs (`gemma-4-26b-a4b-it`, `gemma-4-31b-it`), license links, and the "What the AI does" table (#48)

## Architecture

TODO: rendered architecture diagram from spec §5.1 (#48)

## Setup

TODO: local development (#48)

### Deploy your own

Create a Google Cloud project, link billing, then from Cloud Shell or any
machine with the Google Cloud CLI:

```sh
gcloud auth login
./deploy.sh                    # prompts for the project, region (us-east4), and Gemini API key
./deploy.sh --destroy          # removes it all, after you type the project ID
```

Run it again any time: it skips what exists and ships a new revision. It
prints the server URL to set in the iOS app. The budget alerts are in US
dollars, so the budget step fails on a billing account in another currency.

## API dependency map

TODO: every external service, its use, IAM, cost, and what breaks if it is down (#48)

## Cost

TODO: measured cost table (#51)

## Eval results

TODO: summary of `docs/eval-results.md` (#20, #50)

## Accessibility

TODO (#49)

## Privacy

TODO: see [PRIVACY.md](PRIVACY.md) (#49)

## Limitations

TODO: honest limits from spec §8.4 (#48)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE)
