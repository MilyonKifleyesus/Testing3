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

  # Heuristic: city before "(" is often noise for matching client names.
  $beforeParen = $full -replace "\s*\(.*$", ""
  $normalizedBeforeParen = Normalize-Name -Value $beforeParen
  if ($normalizedBeforeParen) { $candidates.Add($normalizedBeforeParen) }

  return $candidates | Select-Object -Unique
}

if (-not (Test-Path -LiteralPath $JsonPath)) {
  throw "JSON file not found: $JsonPath"
}

$json = Get-Content -Raw -LiteralPath $JsonPath | ConvertFrom-Json
$sourceClients = $json.'clients_Company Addresses'
if ($null -eq $sourceClients -or $sourceClients.Count -eq 0) {
  throw "No entries found in key 'clients_Company Addresses'."
}

$headers = Build-Headers -Token $BearerToken
$clientsUrl = "$($ApiBaseUrl.TrimEnd('/'))/Clients"
$clientsResponse = Invoke-RestMethod -Method Get -Uri $clientsUrl -Headers $headers
$apiClients = @()
if ($clientsResponse -and $clientsResponse.items) {
  $apiClients = @($clientsResponse.items)
} elseif ($clientsResponse -is [System.Array]) {
  $apiClients = @($clientsResponse)
}
if ($apiClients.Count -eq 0) {
  throw "No clients returned from API: $clientsUrl"
}

$apiByName = @{}
foreach ($c in $apiClients) {
  $n = Normalize-Name -Value ([string]$c.clientName)
  if (-not $n) { continue }
  if (-not $apiByName.ContainsKey($n)) {
    $apiByName[$n] = $c
  }
}

$nameAliases = @{
  (Normalize-Name -Value "york region transit") = (Normalize-Name -Value "yrt")
  (Normalize-Name -Value "toronto transit commission") = (Normalize-Name -Value "ttc")
  (Normalize-Name -Value "toronto transit commission ttc") = (Normalize-Name -Value "ttc")
  (Normalize-Name -Value "durham region transit") = (Normalize-Name -Value "drt")
  (Normalize-Name -Value "translink") = (Normalize-Name -Value "translink")
  (Normalize-Name -Value "coast mountain bus company") = (Normalize-Name -Value "translink")
  (Normalize-Name -Value "city of fairfield ca") = (Normalize-Name -Value "fairfield")
  (Normalize-Name -Value "mount sinai hospital") = (Normalize-Name -Value "mount sinai")
}

$updated = 0
$notFound = 0
$skipped = 0
$failed = 0

foreach ($row in $sourceClients) {
  $clientLocation = [string]$row.'client Location'
  $lat = $row.'Y (Latitude)'
  $lng = $row.'X (Longitude)'

  if ([string]::IsNullOrWhiteSpace($clientLocation) -or $null -eq $lat -or $null -eq $lng) {
    $skipped++
    Write-Host "[SKIP] Invalid row for '$clientLocation'"
    continue
  }

  $candidates = Get-Candidate-Names -ClientLocation $clientLocation
  $matchedClient = $null

  foreach ($cand in $candidates) {
    $lookup = $cand
    if (-not $apiByName.ContainsKey($lookup) -and $nameAliases.ContainsKey($cand)) {
      $lookup = $nameAliases[$cand]
    }
    if ($apiByName.ContainsKey($lookup)) {
      $matchedClient = $apiByName[$lookup]
      break
    }
  }

  if ($null -eq $matchedClient) {
    $notFound++
    Write-Host "[MISS] No matching backend client for '$clientLocation'"
    continue
  }

  $clientIdValue = Get-OptionalProp -Obj $matchedClient -Name "clientId"
  if ($null -eq $clientIdValue) { $clientIdValue = Get-OptionalProp -Obj $matchedClient -Name "id" }
  $customerNameValue = Get-OptionalProp -Obj $matchedClient -Name "customerName"
  if ([string]::IsNullOrWhiteSpace([string]$customerNameValue)) {
    $customerNameValue = Get-OptionalProp -Obj $matchedClient -Name "clientName"
  }

  $payload = @{
    id = Get-OptionalProp -Obj $matchedClient -Name "id"
    clientId = $clientIdValue
    customerName = $customerNameValue
    customerLogo = Get-OptionalProp -Obj $matchedClient -Name "customerLogo"
    customerLogoName = Get-OptionalProp -Obj $matchedClient -Name "customerLogoName"
    locationId = Get-OptionalProp -Obj $matchedClient -Name "locationId"
    latitude = [double]$lat
    longitude = [double]$lng
  } | ConvertTo-Json -Depth 6

  if ($DryRun) {
    Write-Host "[DRY-RUN] Would update Client id=$($matchedClient.id) name='$($matchedClient.clientName)' lat=$lat lng=$lng"
    $updated++
    continue
  }

  $putUrl = "$($ApiBaseUrl.TrimEnd('/'))/Clients/$($matchedClient.id)"
  try {
    Invoke-RestMethod -Method Put -Uri $putUrl -Headers $headers -Body $payload | Out-Null
    Write-Host "[OK] Updated Client id=$($matchedClient.id) name='$($matchedClient.clientName)' lat=$lat lng=$lng"
    $updated++
  } catch {
    $failed++
    Write-Host "[FAIL] Client id=$($matchedClient.id) name='$($matchedClient.clientName)' -> $($_.Exception.Message)"
  }
}

Write-Host ""
Write-Host "Summary:"
Write-Host "  Updated: $updated"
Write-Host "  Not Found: $notFound"
Write-Host "  Skipped: $skipped"
Write-Host "  Failed: $failed"
