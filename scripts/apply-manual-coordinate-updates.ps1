param(
  [Parameter(Mandatory = $false)]
  [string]$UpdatesPath = ".\scripts\manual-coordinate-updates.json",

  [Parameter(Mandatory = $false)]
  [string]$ApiBaseUrl = "https://api.fleetpulse.net/api",

  [Parameter(Mandatory = $false)]
  [switch]$DryRun,

  [Parameter(Mandatory = $false)]
  [string]$BearerToken
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13

function Headers {
  param([string]$Token)
  $h = @{
    "Accept" = "application/json"
    "Content-Type" = "application/json"
  }
  if (-not [string]::IsNullOrWhiteSpace($Token)) {
    $h["Authorization"] = "Bearer $Token"
  }
  return $h
}

function Get-OptionalProp {
  param(
    [Parameter(Mandatory = $true)]$Obj,
    [Parameter(Mandatory = $true)][string]$Name
  )
  if ($null -eq $Obj) { return $null }
  $p = $Obj.PSObject.Properties[$Name]
  if ($null -eq $p) { return $null }
  return $p.Value
}

if (-not (Test-Path -LiteralPath $UpdatesPath)) {
  throw "Updates file not found: $UpdatesPath"
}

$base = $ApiBaseUrl.TrimEnd('/')
$headers = Headers -Token $BearerToken
$updates = Get-Content -Raw -LiteralPath $UpdatesPath | ConvertFrom-Json
$locationCache = @{}
if (-not $DryRun) {
  $allLocations = (Invoke-RestMethod -Method Get -Uri "$base/Locations" -Headers $headers).items
  foreach ($loc in @($allLocations)) {
    $n = [string](Get-OptionalProp -Obj $loc -Name "name")
    if ([string]::IsNullOrWhiteSpace($n)) { continue }
    $locationCache[$n.Trim().ToLowerInvariant()] = [int](Get-OptionalProp -Obj $loc -Name "id")
  }
}

function Ensure-Location {
  param(
    [int]$LocationId,
    [string]$Name,
    [double]$Latitude,
    [double]$Longitude
  )

  if ($LocationId -gt 0) {
    if ($DryRun) {
      Write-Host "[DRY-RUN] Would update Location id=$LocationId name='$Name' lat=$Latitude lng=$Longitude"
      return $LocationId
    }

    $locDetail = Invoke-RestMethod -Method Get -Uri "$base/Locations/$LocationId" -Headers $headers
    $locName = [string](Get-OptionalProp -Obj $locDetail -Name "name")
    if ([string]::IsNullOrWhiteSpace($locName)) { $locName = $Name }
    $body = @{
      name = $locName
      latitude = $Latitude
      longitude = $Longitude
    } | ConvertTo-Json -Depth 4
    Invoke-RestMethod -Method Put -Uri "$base/Locations/$LocationId" -Headers $headers -Body $body | Out-Null
    Write-Host "[OK] Updated Location id=$LocationId name='$locName'"
    return $LocationId
  }

  if ($DryRun) {
    Write-Host "[DRY-RUN] Would create Location name='$Name' lat=$Latitude lng=$Longitude"
    return -1
  }

  $autoName = "$Name (Auto)"
  $cacheKey = $autoName.Trim().ToLowerInvariant()
  if ($locationCache.ContainsKey($cacheKey)) {
    $existingId = [int]$locationCache[$cacheKey]
    $body = @{
      name = $autoName
      latitude = $Latitude
      longitude = $Longitude
    } | ConvertTo-Json -Depth 4
    Invoke-RestMethod -Method Put -Uri "$base/Locations/$existingId" -Headers $headers -Body $body | Out-Null
    Write-Host "[OK] Reused Location id=$existingId name='$autoName'"
    return $existingId
  }

  $create = @{
    Name = $autoName
    Latitude = $Latitude
    Longitude = $Longitude
  } | ConvertTo-Json -Depth 4
  $created = Invoke-RestMethod -Method Post -Uri "$base/Locations" -Headers $headers -Body $create
  $createdId = [int](Get-OptionalProp -Obj $created -Name "id")
  $locationCache[$cacheKey] = $createdId
  Write-Host "[OK] Created Location id=$createdId name='$autoName'"
  return $createdId
}

$clientsUpdated = 0
$manufacturersUpdated = 0
$locationsTouched = 0

foreach ($c in @($updates.clientUpdates)) {
  $newLocId = Ensure-Location -LocationId ([int]$c.locationId) -Name ([string]$c.name) -Latitude ([double]$c.latitude) -Longitude ([double]$c.longitude)
  $locationsTouched++

  if ($DryRun) {
    Write-Host "[DRY-RUN] Would update Client id=$($c.id) name='$($c.name)' locationId=$newLocId"
    $clientsUpdated++
    continue
  }

  $detail = Invoke-RestMethod -Method Get -Uri "$base/Clients/$($c.id)" -Headers $headers
  $customerName = [string](Get-OptionalProp -Obj $detail -Name "customerName")
  if ([string]::IsNullOrWhiteSpace($customerName)) { $customerName = [string]$c.name }

  $body = @{
    id = [int]$c.id
    clientId = [int]$c.id
    customerName = $customerName
    customerLogo = Get-OptionalProp -Obj $detail -Name "customerLogo"
    customerLogoName = Get-OptionalProp -Obj $detail -Name "customerLogoName"
    locationId = [int]$newLocId
    latitude = [double]$c.latitude
    longitude = [double]$c.longitude
  } | ConvertTo-Json -Depth 6

  Invoke-RestMethod -Method Put -Uri "$base/Clients/$($c.id)" -Headers $headers -Body $body | Out-Null
  Write-Host "[OK] Updated Client id=$($c.id) locationId=$newLocId"
  $clientsUpdated++
}

foreach ($m in @($updates.manufacturerUpdates)) {
  $newLocId = Ensure-Location -LocationId ([int]$m.locationId) -Name ([string]$m.name) -Latitude ([double]$m.latitude) -Longitude ([double]$m.longitude)
  $locationsTouched++

  if ($DryRun) {
    Write-Host "[DRY-RUN] Would update Manufacturer id=$($m.id) name='$($m.name)' locationId=$newLocId"
    $manufacturersUpdated++
    continue
  }

  $detail = Invoke-RestMethod -Method Get -Uri "$base/Manufacturers/$($m.id)" -Headers $headers
  $mName = [string](Get-OptionalProp -Obj $detail -Name "manufacturerName")
  if ([string]::IsNullOrWhiteSpace($mName)) { $mName = [string]$m.name }

  $body = @{
    id = [int]$m.id
    manufacturerName = $mName
    manufacturerLogo = Get-OptionalProp -Obj $detail -Name "manufacturerLogo"
    manufacturerLogoName = Get-OptionalProp -Obj $detail -Name "manufacturerLogoName"
    locationId = [int]$newLocId
  } | ConvertTo-Json -Depth 6

  Invoke-RestMethod -Method Put -Uri "$base/Manufacturers/$($m.id)" -Headers $headers -Body $body | Out-Null
  Write-Host "[OK] Updated Manufacturer id=$($m.id) locationId=$newLocId"
  $manufacturersUpdated++
}

Write-Host ""
Write-Host "Summary:"
Write-Host "  Locations Touched: $locationsTouched"
Write-Host "  Clients Updated: $clientsUpdated"
Write-Host "  Manufacturers Updated: $manufacturersUpdated"
