# Deploy TARAsense on Ubuntu (Node + PM2 + Nginx)

This app is a fullstack Next.js app with a Node.js runtime and PostgreSQL (Prisma).

## 1) Install base packages

```bash
sudo apt update
sudo apt install -y curl git build-essential nginx
```

## 2) Install Node.js 22 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

## 3) Install and prepare PostgreSQL

```bash
sudo apt install -y postgresql postgresql-contrib
sudo -u postgres psql
```

Run inside `psql`:

```sql
CREATE USER tarasense WITH PASSWORD 'change_this_password';
CREATE DATABASE tarasense OWNER tarasense;
\q
```

## 4) Upload project and install dependencies

If your repository has a nested `tarasense/` folder, deploy from that folder.

```bash
git clone <your-repo-url>
cd <your-repo>/tarasense
npm ci
```

## 5) Configure environment variables

```bash
cp .env.example .env
nano .env
```

Set at least:

```env
DATABASE_URL="postgresql://tarasense:change_this_password@127.0.0.1:5432/tarasense?schema=public"
NEXTAUTH_URL="https://your-domain.com"
ADMIN_EMAIL="admin@your-domain.com"
ADMIN_PASSWORD="strong-admin-password"
```

`OPENAI_API_KEY` is optional.

## 6) Initialize Prisma and build app

This repository currently has no Prisma migrations folder, so use `db push` for first setup:

```bash
npx prisma generate
npx prisma db push
npm run build
```

## 7) Run with PM2

```bash
sudo npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd
```

After `pm2 startup systemd`, run the command PM2 prints (one-time step).

Check app status:

```bash
pm2 status
pm2 logs tarasense-web --lines 100
```

## 8) Configure Nginx reverse proxy

```bash
sudo cp deploy/nginx.tarasense.conf /etc/nginx/sites-available/tarasense
sudo nano /etc/nginx/sites-available/tarasense
```

Update `server_name` with your real domain, then enable:

```bash
sudo ln -s /etc/nginx/sites-available/tarasense /etc/nginx/sites-enabled/tarasense
sudo nginx -t
sudo systemctl reload nginx
```

## 9) Enable HTTPS (recommended)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

## 10) Useful update flow

```bash
cd <your-repo>/tarasense
git pull
npm ci
npx prisma generate
npx prisma db push
npm run build
pm2 restart tarasense-web
```

## 11) 8:00 AM reminder job (optional)

Set in `.env`:

```env
CRON_SECRET="replace-with-strong-secret"
REMINDER_TIMEZONE="Asia/Manila"
```

Add cron entry:

```bash
crontab -e
```

Then add:

```cron
0 8 * * * curl -s -X POST http://127.0.0.1:3000/api/jobs/session-reminders -H "x-cron-secret: replace-with-strong-secret" >/dev/null 2>&1
```
