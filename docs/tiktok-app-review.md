# TikTok app review setup for Argentum

This checklist keeps the public website separate from the downloaded Argentum OS and Clipping Office workspace.

## Public URLs

After the cloud deployment has a real HTTPS domain, enter:

- Website URL: `https://YOUR-DOMAIN/`
- Terms of Service URL: `https://YOUR-DOMAIN/terms`
- Privacy Policy URL: `https://YOUR-DOMAIN/privacy`
- Support and data requests: `https://YOUR-DOMAIN/support`

The website root is intentionally public in cloud mode. The private operator console remains at `/app` behind `/login`. Local/Electron mode still opens the Argentum application at `/`.

## Before submission

- Replace the launch note on `/support` with the operator's real, monitored support/privacy email.
- Identify the legal service operator and governing jurisdiction in the Terms and Privacy Policy.
- Deploy the site on a stable HTTPS domain. Do not submit a localhost, temporary tunnel, login page, or unfinished preview.
- Confirm that the homepage visibly links to Terms and Privacy without requiring a menu click.
- Confirm that `/`, `/terms`, `/privacy`, and `/support` load while signed out.
- In TikTok for Developers, select **Web** if the production authorization and redirect flow is web-based. Select **Desktop** only if Argentum will use TikTok's desktop authorization flow. The selected platform must match the integration shown in the review video.
- Add the exact HTTPS redirect URI required by the selected TikTok product. It must be absolute, static, contain no query string or fragment, and match the implemented callback route.
- Request only the TikTok products and scopes that Argentum actually uses.
- Verify ownership of the website, Terms, Privacy, and any Content Posting API URLs using TikTok's URL Properties workflow. Add TikTok's exact verification file to `website/` when it is issued; do not invent or rename the verification value.
- Test the complete integration in TikTok Sandbox before production review.
- Record a current end-to-end demo video that shows the same domain, all requested products and scopes, the authorization flow, user interaction, and the complete feature outcome.
- Keep platform client secrets and user tokens server-side. Never add them to the public HTML, CSS, JavaScript, screenshots, or source control.

## Suggested app details

App name:

`Argentum`

Description (under 120 characters):

`Turn approved long-form video into reviewed short-form clips, captions, and publishing packages.`

Platform:

`Web` for the website-based OAuth configuration requested here.

The public website does not by itself complete TikTok review. TikTok also expects a functioning integration, a matching redirect URI, URL ownership verification, requested-scope explanations, and an end-to-end demo video.
