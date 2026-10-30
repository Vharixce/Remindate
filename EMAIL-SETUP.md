# Remindate – email notifications setup

Remindate is a website without its own server, so the emails are sent by a small
**GitHub Actions** workflow in this repo (`Vharixce/Remindate`):

- every ~10 minutes it reads `notes.json` from your private data repo (`Vharixce/Remindate-DATA-PRIVATE`),
- emails every note that has **Send Email Notification** on and whose time (or repeat) just passed,
- and writes `remindate-email-state.json` to the data repo so nothing is sent twice.

It works even when your computer and phone are off. GitHub's timer is not exact, so an email
can arrive **a few minutes late** (sometimes up to ~15 min at busy moments).

The workflow file is `scripts/email-reminders.yml` (it has to be moved to
`.github/workflows/`, see step 4) and the script is `scripts/email-reminders.mjs`.

---

## 1. Make a Gmail app password

Google doesn't let scripts use your normal password; you need an **app password**.

1. Turn on **2-Step Verification** for your Google account (if it isn't already):
   <https://myaccount.google.com/signinoptions/two-step-verification>
2. Go to **App passwords**: <https://myaccount.google.com/apppasswords>
3. Name it `Remindate` and click **Create**.
4. Copy the 16-character code (spaces don't matter). You only see it once.

Tip: you can send *from* a separate Gmail account just for Remindate and send *to* your own address.

## 2. A token that can read your data repo

You probably already have one: the fine-grained token you use in **GitHub Sync settings** in
Remindate works (it needs **Contents: Read and write** on `Remindate-DATA-PRIVATE`).

Or make a new one at <https://github.com/settings/personal-access-tokens>:
- Repository access: **Only select repositories** → `Remindate-DATA-PRIVATE`
- Permissions → Repository → **Contents: Read and write**

## 3. Add the secrets to the Remindate repo

Open <https://github.com/Vharixce/Remindate/settings/secrets/actions> →
**New repository secret**, three times:

| Name                   | Value                                   |
|------------------------|-----------------------------------------|
| `REMINDATE_DATA_TOKEN` | the token from step 2                   |
| `GMAIL_USER`           | the Gmail address that sends the emails |
| `GMAIL_APP_PASSWORD`   | the app password from step 1            |

Secrets are never shown in logs, also not in a public repo.

Optional settings go under the **Variables** tab on the same page:

| Variable                | Default                                  |
|-------------------------|------------------------------------------|
| `REMINDATE_TIMEZONE`    | `Europe/Amsterdam`                       |
| `REMINDATE_DATA_REPO`   | `Vharixce/Remindate-DATA-PRIVATE`        |
| `REMINDATE_DATA_PATH`   | `notes.json`                             |
| `REMINDATE_APP_URL`     | `https://vharixce.github.io/Remindate/`  |

## 4. Move the workflow file and push

GitHub only runs workflows from the `.github/workflows` folder. Move the workflow file there
first. In the Remindate folder (Command Prompt / PowerShell):

```
mkdir .github\workflows
move scripts\email-reminders.yml .github\workflows\email-reminders.yml
```

Then commit and push like you normally do:

```
git add .github/workflows/email-reminders.yml scripts/email-reminders.mjs EMAIL-SETUP.md app.js index.html style.css
git commit -m "Email notifications"
git push
```

## 5. Turn on sync in Remindate

The workflow only sees what is on GitHub, so in Remindate open **GitHub Sync settings** and
tick **Sync automatically after changes** (or press **Sync now** after changing a note).

## 6. Test it

1. In Remindate, make a note for **2–3 minutes from now**, tick **Send Email Notification**,
   enter your address and make sure it synced.
2. Wait until that time has passed.
3. On GitHub go to **Actions → Remindate email reminders → Run workflow**.
4. Check your inbox (and the spam folder the first time; mark it "not spam").

In the run's log you'll see a line like `Checked 12 notes · 1 reminder(s) due`.
Email addresses and note titles are never printed there.

---

### Good to know

- **Late emails.** If GitHub's timer is very late, reminders up to 2 hours old are still sent.
  Anything older is skipped.
- **Repeats** (weekly, monthly, yearly) each get their own email. Days you removed with
  "Remove from date → Only this day" are skipped.
- **Images, voice notes and drawings** aren't attached. The email says the note has them and links to Remindate.
- **Private repo?** Public repos get unlimited free Actions minutes. If `Vharixce/Remindate`
  is private, every run counts toward 2,000 free minutes a month. In that case change
  `*/10` to `*/30` in `.github/workflows/email-reminders.yml`.
- GitHub pauses scheduled workflows after 60 days without activity in a repo. The workflow
  makes a tiny empty commit every ~50 days to prevent that.
- **Stop all emails:** disable the workflow in the Actions tab, or untick the checkbox on the notes.
