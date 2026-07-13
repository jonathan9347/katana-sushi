Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

docker compose -f .\database\docker-compose.yml up -d
Start-Sleep -Seconds 5

Set-Location .\backend
npm.cmd install
npx.cmd prisma generate
npx.cmd prisma db push
npx.cmd prisma db seed

Set-Location ..\frontend
npm.cmd install

Set-Location ..
Write-Host "Setup complete! Run 'Set-Location .\backend; npm.cmd run dev' and 'Set-Location .\frontend; npm.cmd run dev'"
