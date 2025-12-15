# Script para poblar productos en la base de datos
# Ejecutar con: ./seed-products.ps1

Write-Host "🌱 POBLANDO BASE DE DATOS DE PRODUCTOS`n" -ForegroundColor Green

$products = @(
    @{ name = "Laptop"; price = 1200; stock = 10 },
    @{ name = "Mouse"; price = 25; stock = 50 },
    @{ name = "Teclado"; price = 45; stock = 30 },
    @{ name = "Monitor"; price = 300; stock = 15 },
    @{ name = "Webcam"; price = 80; stock = 20 }
)

Write-Host "Nota: Este script requiere acceso directo a la base de datos SQLite" -ForegroundColor Yellow
Write-Host "Para crear productos, usa el script seed.ts en products-service:`n" -ForegroundColor Yellow
Write-Host "  cd products-service" -ForegroundColor Cyan
Write-Host "  npm run seed`n" -ForegroundColor Cyan

Write-Host "Productos a crear:" -ForegroundColor Green
$products | ForEach-Object {
    Write-Host "  - $($_.name): `$$($_.price) (Stock: $($_.stock))" -ForegroundColor White
}
