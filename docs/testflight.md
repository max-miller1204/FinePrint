# TestFlight

`.github/workflows/testflight.yml` builds the iOS app on a GitHub macOS runner (Xcode 26), signs it, and uploads it to TestFlight. It runs on every push to `main` that changes `ios/`, and by hand:

```sh
gh workflow run testflight.yml
gh run watch "$(gh run list --workflow testflight.yml --limit 1 --json databaseId -q '.[0].databaseId')"
```

No one needs a Mac, a certificate, or a provisioning profile. Xcode makes and keeps the signing certificate in the cloud (cloud-managed signing) using an App Store Connect API key.

## What a build contains

- **Version:** `MARKETING_VERSION` in the project (now `0.1.0`). Change it in Xcode for a new release.
- **Build number:** `<run number>.<attempt>`, such as `41.1`. Every run gets a new one, so uploads never collide.
- **Server:** the deployed server in `ios/Config/DeployedServer.xcconfig`. The workflow fails if the archived app points at `localhost` or plain `http`. The run summary shows the server and build number.
- **Export compliance:** `ITSAppUsesNonExemptEncryption = NO` (in `ios/Config/Info-Additions.plist`). The app only uses HTTPS and SHA-256 hashing, which are exempt, so App Store Connect does not ask about encryption for each build.

## One-time setup

An Account Holder or Admin of the Apple Developer team does these steps once.

### 1. Create the app record

1. In [App Store Connect](https://appstoreconnect.apple.com/apps), choose **+** > **New App**.
2. Platform **iOS**, name **FinePrint** (or any free name), primary language **English (U.S.)**, SKU `fineprint`.
3. Bundle ID: **org.fineprint.FinePrint**. If it is not in the list, register it first in [Identifiers](https://developer.apple.com/account/resources/identifiers/list) (App ID, explicit, no capabilities), then reload the form.

### 2. Create the API key

1. App Store Connect > **Users and Access** > **Integrations** > **App Store Connect API** > **Team Keys**. Request access first if the tab asks.
2. Choose **+**, name it `GitHub TestFlight`, access **Admin**. Cloud-managed distribution certificates need Admin: with App Manager, the export fails with a cloud signing permission error.
3. Download the `.p8` file. Apple lets you download it only once.
4. Note the **Key ID** (in the key's row) and the **Issuer ID** (above the table).

### 3. Add the GitHub secrets and variable

In the repository, **Settings** > **Secrets and variables** > **Actions**:

| Kind | Name | Value |
|---|---|---|
| Secret | `ASC_KEY_ID` | Key ID, such as `2X9R4HXF34` |
| Secret | `ASC_ISSUER_ID` | Issuer ID, a UUID |
| Secret | `ASC_KEY_P8` | The full text of the `.p8` file, including the `BEGIN` and `END` lines |
| Variable | `APPLE_TEAM_ID` | The 10-character Team ID from [Membership details](https://developer.apple.com/account#MembershipDetailsCard) |

Or from a terminal, so the key never appears in the shell history:

```sh
gh secret set ASC_KEY_ID
gh secret set ASC_ISSUER_ID
gh secret set ASC_KEY_P8 < ~/Downloads/AuthKey_XXXXXXXXXX.p8
gh variable set APPLE_TEAM_ID --body XXXXXXXXXX
```

Then delete the downloaded `.p8`, or keep it in a password manager.

### 4. Internal testers

1. App Store Connect > the app > **TestFlight** > **Internal Testing** > **+**, name the group `Team`.
2. Add each teammate. They must be users of the App Store Connect team first (**Users and Access** > **+**, any role).
3. Turn on **Automatic Distribution** so every new build reaches the group.

Testers install the **TestFlight** app on their iPhone and accept the email invite.

### 5. External beta (public link)

1. **TestFlight** > **External Testing** > **+**, name the group `Public`, add a build.
2. Fill in **Test Information** (feedback email, description, privacy policy URL) and submit for Beta App Review. The first review takes about a day.
3. After approval, turn on **Public Link** for the group and share that link.

## When a run fails

| Error | Fix |
|---|---|
| `Missing ASC_KEY_ID ...` | Add the secret or variable it names (step 3). |
| `No profiles for 'org.fineprint.FinePrint' were found` or `Cloud signing permission error` | The API key needs the **Admin** role (step 2). |
| `No suitable application records were found` | Create the app record (step 1) with the same bundle ID. |
| `The bundle version must be higher than the previously uploaded version` | A build with a higher number exists. Upload a newer one by running the workflow again. |
| `Missing required icon file` | The app icon in `ios/FinePrint/Assets.xcassets/AppIcon.appiconset` must be a 1024x1024 PNG with no transparency. |
