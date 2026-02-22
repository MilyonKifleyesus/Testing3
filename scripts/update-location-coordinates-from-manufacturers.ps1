param(
  [Parameter(Mandatory = $false)]
  [string]$JsonPath = "C:\Users\Owner\Downloads\manufacturers.json",

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

function Normalize-Name {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return "" }
  return (($Value.Trim() -replace "\s+", " ").ToLowerInvariant())
}

function Build-Headers {
  param([string]$Token)
  $headers = @{
    "Accept" = "application/json"
    "Content-Type" = "application/json"
  }
  if (-not [string]::IsNullOrWhiteSpace($Token)) {
    $headers["Authorization"] = "Bearer $Token"
  }
  return $headers
}

if (-not (Test-Path -LiteralPath $JsonPath)) {
  throw "JSON file not found: $JsonPath"
}

$json = Get-Content -Raw -LiteralPath $JsonPath | ConvertFrom-Json
$facilities = $json.'manufacturers_Manufacturing Facilities'
if ($null -eq $facilities -or $facilities.Count -eq 0) {
  throw "No facilities found in key 'manufacturers_Manufacturing Facilities'."
}

$headers = Build-Headers -Token $BearerToken
$locationsUrl = "$($ApiBaseUrl.TrimEnd('/'))/Locations"
$locationsResponse = Invoke-RestMethod -Method Get -Uri $locationsUrl -Headers $headers

$locations = @()
if ($locationsResponse -and $locationsResponse.items) {
  $locations = @($locationsResponse.items)
} elseif ($locationsResponse -is [System.Array]) {
  $locations = @($locationsResponse)
}

if ($locations.Count -eq 0) {
  throw "No locations returned from API: $locationsUrl"
}

$locationByName = @{}
foreach ($loc in $locations) {
  $normalized = Normalize-Name -Value $loc.name
  if ([string]::IsNullOrWhiteSpace($normalized)) { continue }
  if (-not $locationByName.ContainsKey($normalized)) {
    $locationByName[$normalized] = $loc
  }
}

# Safe aliases for known backend naming differences.
$nameAliases = @{
  (Normalize-Name -Value "Saint-Eustache (Nova Bus)") = (Normalize-Name -Value "St. Eustache (Nova)")
  (Normalize-Name -Value "Middlebury (ARBOC)") = (Normalize-Name -Value "Middlebury IN (Arboc)")
  (Normalize-Name -Value "Riverside (ENC)") = (Normalize-Name -Value "Riverside California")
}

$updated = 0
$skipped = 0
$notFound = 0

foreach ($facility in $facilities) {
  $facilityName = [string]$facility.'Facility Location'
  $lat = $facility.'Y (Latitude)'
  $lng = $facility.'X (Longitude)'
  $normalizedFacilityName = Normalize-Name -Value $facilityName

  if ([string]::IsNullOrWhiteSpace($normalizedFacilityName)) {
    $skipped++
    Write-Host "[SKIP] Empty facility name"
    continue
  }

  if ($null -eq $lat -or $null -eq $lng) {
    $skipped++
    Write-Host "[SKIP] Missing coordinates for '$facilityName'"
    continue
  }

  $parsedLat = 0.0
  $parsedLng = 0.0
  $latOk = [double]::TryParse(
    [string]$lat,
    [System.Globalization.NumberStyles]::Float,
    [System.Globalization.CultureInfo]::InvariantCulture,
    [ref]$parsedLat
  )
  $lngOk = [double]::TryParse(
    [string]$lng,
    [System.Globalization.NumberStyles]::Float,
    [System.Globalization.CultureInfo]::InvariantCulture,
    [ref]$parsedLng
  )
  if (-not $latOk -or -not $lngOk -or $parsedLat -lt -90 -or $parsedLat -gt 90 -or $parsedLng -lt -180 -or $parsedLng -gt 180) {
    $skipped++
    Write-Host "[SKIP] Invalid coordinates for '$facilityName' lat='$lat' lng='$lng'"
    continue
  }

  $lookupName = $normalizedFacilityName
  if (-not $locationByName.ContainsKey($lookupName) -and $nameAliases.ContainsKey($normalizedFacilityName)) {
    $lookupName = $nameAliases[$normalizedFacilityName]
  }

  if (-not $locationByName.ContainsKey($lookupName)) {
    $notFound++
    Write-Host "[MISS] No matching backend location for '$facilityName'"
    continue
  }

  $location = $locationByName[$lookupName]
  $putUrl = "$($ApiBaseUrl.TrimEnd('/'))/Locations/$($location.id)"

  if ($DryRun) {
    Write-Host "[DRY-RUN] Would update Location id=$($location.id) name='$($location.name)' lat=$parsedLat lng=$parsedLng"
    $updated++
    continue
  }

  try {
    $existingLocationResponse = Invoke-RestMethod -Method Get -Uri $putUrl -Headers $headers
    $existingLocation = $null
    if ($existingLocationResponse -and $existingLocationResponse.item) {
      $existingLocation = $existingLocationResponse.item
    } elseif ($existingLocationResponse -and $existingLocationResponse.items -and $existingLocationResponse.items.Count -gt 0) {
      $existingLocation = $existingLocationResponse.items[0]
    } else {
      $existingLocation = $existingLocationResponse
    }

    $bodyObject = @{}
    if ($existingLocation) {
      foreach ($prop in $existingLocation.PSObject.Properties) {
        $bodyObject[$prop.Name] = $prop.Value
      }
    }
    $bodyObject["name"] = if ($bodyObject.ContainsKey("name") -and -not [string]::IsNullOrWhiteSpace([string]$bodyObject["name"])) { [string]$bodyObject["name"] } else { [string]$location.name }
    $bodyObject["latitude"] = [double]$parsedLat
    $bodyObject["longitude"] = [double]$parsedLng

    $body = $bodyObject | ConvertTo-Json -Depth 10
    Invoke-RestMethod -Method Put -Uri $putUrl -Headers $headers -Body $body | Out-Null
    Write-Host "[OK] Updated Location id=$($location.id) name='$($location.name)' lat=$parsedLat lng=$parsedLng"
    $updated++
  } catch {
    $skipped++
    Write-Host "[FAIL] Location id=$($location.id) facility='$facilityName' could not be updated: $($_.Exception.Message)"
    continue
  }
}

Write-Host ""
Write-Host "Summary:"
Write-Host "  Updated: $updated"
Write-Host "  Not Found: $notFound"
Write-Host "  Skipped: $skipped"
