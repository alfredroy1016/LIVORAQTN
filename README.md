# Livora Quotation Studio (Node.js + MongoDB)

Create quotations in minutes, keep them in MongoDB, print or save them as A4 PDF.

## What you need
1. **Node.js 20 or newer** – https://nodejs.org (choose the LTS download)
2. **A MongoDB database** – pick one:
   - **MongoDB Atlas (free, easiest):** make a free cluster at https://www.mongodb.com/atlas, create a database user, allow your IP address, then copy the connection string (it starts with `mongodb+srv://`).
   - **MongoDB on your own computer:** install MongoDB Community Server. The connection string is `mongodb://127.0.0.1:27017`.

## First-time setup
Open a terminal in this folder and run:

```
npm install
```

Copy `.env.example` to a new file called `.env`, then edit it:

| Setting | Meaning |
|---|---|
| `MONGODB_URI` | Your connection string from above |
| `ADMIN_PASSWORD` | The password you will type on the login screen |
| `SESSION_SECRET` | Any long random text (16+ characters) |

## Run it
```
npm start
```
Open **http://localhost:3000**, log in with your `ADMIN_PASSWORD`.

## Using it
- **Save** stores the quotation in MongoDB and gives it the next number (`LIV-2611-0001`, `LIV-2611-0002` …). The serial restarts at 0001 each month. Numbers are handed out by the database, so two people saving at the same time never get the same number.
- **Saved (n)** lists every quotation. Open, delete, or download a backup file.
- **Copy as new** duplicates the quotation you are looking at with a fresh number.
- **Print** opens the print dialog. In it, set margins to *None* and turn off *Headers and footers*.
- **Save PDF** downloads an A4 PDF file straight away. It loads the PDF libraries from the internet the first time. If that is not possible it opens the print dialog instead, where you choose *Save as PDF*.
- Company details and the cover image (Company and branding) are stored in the database too.

## Put it online (optional)
Run it on any Node host (a VPS, Render, Railway). Set the same three settings as environment variables, use HTTPS, and keep `ADMIN_PASSWORD` long. Without HTTPS the password travels unprotected.

For Vercel, import this repository and set the project root to the repository root. `server.ts` exports the Vercel request handler. Keep the existing MongoDB and login environment variables configured in the Vercel project; do not commit `.env`.

## Check that it works
```
npm test
```
Runs 26 checks of the server (login, numbering, saving, deleting). It uses a built-in fake database, so it needs no MongoDB.

## Files
- `server.js` – the whole server (login, API, MongoDB, serves the page)
- `public/index.html` – the quotation screen and A4 layout
- `test/` – automatic checks
# LIVORA-QTN
