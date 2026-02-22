param(
  [Parameter(Mandatory = $false)]
  [string]$JsonPath = "C:\Users\Owner\Downloads\clients.json",

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
  $v = $Value.ToLowerInvariant().Trim()
  $v = $v -replace "[^a-z0-9\+]+", " "
  return ($v -replace "\s+", " ").Trim()
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

function Get-Candidate-Names {
  param([string]$ClientLocation)
  $candidates = New-Object System.Collections.Generic.List[string]
  if ([string]::IsNullOrWhiteSpace($ClientLocation)) {
    return $candidates
  }

  $full = $ClientLocation.Trim()
  $normalizedFull = Normalize-Name -Value $full
  if ($normalizedFull) { $candidates.Add($normalizedFull) }

  $matches = [regex]::Matches($full, "\(([^)]+)\)")
  foreach ($m in $matches) {
    $inner = Normalize-Name -Value $m.Groups[1].Value
    if ($inner) { $candidates.Add($inner) }
  }

  $beforeParen = $full -replace "\s*\(.*$", ""
  $normalizedBeforeParen = Normalize-Name -Value $beforeParen
  if ($normalizedBeforeParen) { $candidates.Add($normalizedBeforeParen) }

  return $candidates | Select-Object -Unique
}

if (-not (Test-Path -LiteralPath $JsonPath)) {
  throw "JSON file not found: $JsonPath"
}

$headers = Build-Headers -Token $BearerToken
$base = $ApiBaseUrl.TrimEnd('/')

$sourceJson = Get-Content -Raw -LiteralPath $JsonPath | ConvertFrom-Json
$sourceRows = @($sourceJson.'clients_Company Addresses')
if ($sourceRows.Count -eq 0) {
  throw "No entries found in key 'clients_Company Addresses'."
}

$clientsResponse = Invoke-RestMethod -Method Get -Uri "$base/Clients" -Headers $headers
$apiClients = @($clientsResponse.items)
if ($apiClients.Count -eq 0) {
  throw "No clients returned from API."
}

$locationsResponse = Invoke-RestMethod -Method Get -Uri "$base/Locations" -Headers $headers
$apiLocations = @($locationsResponse.items)

$clientsByName = @{}
foreach ($c in $apiClients) {
  $n = Normalize-Name -Value ([string](Get-OptionalProp -Obj $c -Name "clientName"))
  if (-not $n) { continue }
  if (-not $clientsByName.ContainsKey($n)) { $clientsByName[$n] = $c }
}

$nameAliases = @{
  (Normalize-Name -Value "york region transit") = (Normalize-Name -Value "yrt")
  (Normalize-Name -Value "toronto transit commission") = (Normalize-Name -Value "ttc")
  (Normalize-Name -Value "toronto transit commission ttc") = (Normalize-Name -Value "ttc")
  (Normalize-Name -Value "durham region transit") = (Normalize-Name -Value "drt")
  (Normalize-Name -Value "coast mountain bus company") = (Normalize-Name -Value "translink")
}

$sourceByClientId = @{}
foreach ($row in $sourceRows) {
  $clientLocation = [string]$row.'client Location'
  $lat = $row.'Y (Latitude)'
  $lng = $row.'X (Longitude)'
  if ([string]::IsNullOrWhiteSpace($clientLocation) -or $null -eq $lat -or $null -eq $lng) { continue }

  $matchedClient = $null
  $candidates = Get-Candidate-Names -ClientLocation $clientLocation
  foreach ($cand in $candidates) {
    $lookup = $cand
    if (-not $clientsByName.ContainsKey($lookup) -and $nameAliases.ContainsKey($cand)) {
      $lookup = $nameAliases[$cand]
    }
    if ($clientsByName.ContainsKey($lookup)) {
      $matchedClient = $clientsByName[$lookup]
      break
    }
  }

  if ($null -eq $matchedClient) { continue }
  $id = [string](Get-OptionalProp -Obj $matchedClient -Name "id")
  if ([string]::IsNullOrWhiteSpace($id)) { continue }
  if (-not $sourceByClientId.ContainsKey($id)) {
    $sourceByClientId[$id] = $row
  }
}

$fallbackByClientName = @{
  (Normalize-Name -Value "Saskatoon Transit") = @{ locationName = "Saskatoon (Saskatoon Transit)"; latitude = 52.1332; longitude = -106.6700 }
  (Normalize-Name -Value "Kingston Transit") = @{ locationName = "Kingston (Kingston Transit)"; latitude = 44.2312; longitude = -76.4860 }
  (Normalize-Name -Value "54 Davies") = @{ locationName = "54 Davies"; latitude = 43.7020; longitude = -79.3480 }
  (Normalize-Name -Value "BoltBus") = @{ locationName = "New York (BoltBus)"; latitude = 40.7570; longitude = -73.9900 }
  (Normalize-Name -Value "BusPulse") = @{ locationName = "Toronto (BusPulse)"; latitude = 43.6532; longitude = -79.3832 }
}

$locationsByName = @{}
foreach ($loc in $apiLocations) {
  $n = Normalize-Name -Value ([string](Get-OptionalProp -Obj $loc -Name "name"))
  if (-not $n) { continue }
  if (-not $locationsByName.ContainsKey($n)) { $locationsByName[$n] = $loc }
}

$clientPreferredLocationName = @{
  "9" = "YRT - Bus Garage"
}

$updatedClients = 0
$updatedLocations = 0
$createdLocations = 0
$failed = 0

foreach ($client in $apiClients) {
  $clientId = [string](Get-OptionalProp -Obj $client -Name "id")
  $clientName = [string](Get-OptionalProp -Obj $client -Name "clientName")
  $clientNameNorm = Normalize-Name -Value $clientName

  $clientLocationName = $null
  $lat = $null
  $lng = $null

  if ($sourceByClientId.ContainsKey($clientId)) {
    $row = $sourceByClientId[$clientId]
    $clientLocationName = [string]$row.'client Location'
    $lat = [double]$row.'Y (Latitude)'
    $lng = [double]$row.'X (Longitude)'
  } elseif ($fallbackByClientName.ContainsKey($clientNameNorm)) {
    $fallback = $fallbackByClientName[$clientNameNorm]
    $clientLocationName = [string]$fallback.locationName
    $lat = [double]$fallback.latitude
    $lng = [double]$fallback.longitude
  } else {
    continue
  }

  $locationNameToUse = $clientLocationName.Trim()
  if ($clientPreferredLocationName.ContainsKey($clientId)) {
    $locationNameToUse = $clientPreferredLocationName[$clientId]
  }
  $locationNameNorm = Normalize-Name -Value $locationNameToUse

  $location = $null
  if ($locationsByName.ContainsKey($locationNameNorm)) {
    $location = $locationsByName[$locationNameNorm]
  } else {
    if ($DryRun) {
      Write-Host "[DRY-RUN] Would create location '$locationNameToUse' lat=$lat lng=$lng"
      $createdLocations++
      $location = @{ id = -1; name = $locationNameToUse }
    } else {
      try {
        $createBody = @{
          Name = $locationNameToUse
          Latitude = $lat
          Longitude = $lng
        } | ConvertTo-Json -Depth 4
        $created = Invoke-RestMethod -Method Post -Uri "$base/Locations" -Headers $headers -Body $createBody
        $createdId = [int](Get-OptionalProp -Obj $created -Name "id")
        $location = Invoke-RestMethod -Method Get -Uri "$base/Locations/$createdId" -Headers $headers
        $locationsByName[$locationNameNorm] = $location
        $createdLocations++
        Write-Host "[OK] Created location id=$createdId name='$locationNameToUse'"
      } catch {
        $failed++
        Write-Host "[FAIL] Create location for client id=$clientId name='$locationNameToUse' -> $($_.Exception.Message)"
        continue
      }
    }
  }

  if ($DryRun) {
    Write-Host "[DRY-RUN] Would update location id=$($location.id) name='$locationNameToUse' lat=$lat lng=$lng"
  } else {
    try {
      $locId = [int](Get-OptionalProp -Obj $location -Name "id")
      $updateLocBody = @{
        name = $locationNameToUse
        latitude = $lat
        longitude = $lng
      } | ConvertTo-Json -Depth 4
      Invoke-RestMethod -Method Put -Uri "$base/Locations/$locId" -Headers $headers -Body $updateLocBody | Out-Null
      $updatedLocations++
      Write-Host "[OK] Updated location id=$locId name='$locationNameToUse'"
    } catch {
      $failed++
      Write-Host "[FAIL] Update location for client id=$clientId -> $($_.Exception.Message)"
      continue
    }
  }

  if ($DryRun) {
    Write-Host "[DRY-RUN] Would set client id=$clientId locationId=$($location.id)"
    $updatedClients++
    continue
  }

  try {
    $detail = Invoke-RestMethod -Method Get -Uri "$base/Clients/$clientId" -Headers $headers
    $customerName = [string](Get-OptionalProp -Obj $detail -Name "customerName")
    if ([string]::IsNullOrWhiteSpace($customerName)) {
      $customerName = [string](Get-OptionalProp -Obj $client -Name "clientName")
    }
    $clientPutBody = @{
      id = [int]$clientId
      clientId = [int]$clientId
      customerName = $customerName
      customerLogo = Get-OptionalProp -Obj $detail -Name "customerLogo"
      customerLogoName = Get-OptionalProp -Obj $detail -Name "customerLogoName"
      locationId = [int](Get-OptionalProp -Obj $location -Name "id")
      latitude = $lat
      longitude = $lng
    } | ConvertTo-Json -Depth 6
    Invoke-RestMethod -Method Put -Uri "$base/Clients/$clientId" -Headers $headers -Body $clientPutBody | Out-Null
    $updatedClients++
    Write-Host "[OK] Updated client id=$clientId locationId=$([int](Get-OptionalProp -Obj $location -Name "id"))"
  } catch {
    $failed++
    Write-Host "[FAIL] Update client id=$clientId -> $($_.Exception.Message)"
  }
}

Write-Host ""
Write-Host "Summary:"
Write-Host "  Clients Updated: $updatedClients"
Write-Host "  Locations Updated: $updatedLocations"
Write-Host "  Locations Created: $createdLocations"
Write-Host "  Failed: $failed"
