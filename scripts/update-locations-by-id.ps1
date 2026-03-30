[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$BaseUrl = 'https://api.fleetpulse.net/api',

  [Parameter(Mandatory = $false)]
  [string]$InputFile = 'scripts/location-updates.by-id.json',

  [Parameter(Mandatory = $false)]
  [string]$BearerToken,

  [Parameter(Mandatory = $false)]
  [int]$TimeoutSec = 30,

  [Parameter(Mandatory = $false)]
  [switch]$DryRun,

  [Parameter(Mandatory = $false)]
  [switch]$StopOnError
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

try {
  $tls = [System.Net.SecurityProtocolType]::Tls12
  if ([Enum]::GetNames([System.Net.SecurityProtocolType]) -contains 'Tls13') {
    $tls = $tls -bor [System.Net.SecurityProtocolType]::Tls13
  }
  [System.Net.ServicePointManager]::SecurityProtocol = $tls
}
catch {
}

if ([string]::IsNullOrWhiteSpace($BearerToken)) {
  $BearerToken = $env:BP_API_TOKEN
}

function Write-Info {
  param([string]$Message)
  Write-Host "[INFO] $Message"
}

function Write-WarnMsg {
  param([string]$Message)
  Write-Warning $Message
}

function Get-HttpHeaders {
  $headers = @{
    Accept = 'application/json'
  }

  if (-not [string]::IsNullOrWhiteSpace($BearerToken)) {
    $headers['Authorization'] = "Bearer $BearerToken"
  }

  return $headers
}

function Invoke-ApiJson {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('GET', 'PUT')] [string]$Method,
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $false)]$Body
  )

  $headers = Get-HttpHeaders

  if ($Method -eq 'GET') {
    return Invoke-RestMethod -Method Get -Uri $Uri -Headers $headers -TimeoutSec $TimeoutSec
  }

  $json = $Body | ConvertTo-Json -Depth 20
  $headers['Content-Type'] = 'application/json'
  return Invoke-RestMethod -Method Put -Uri $Uri -Headers $headers -Body $json -TimeoutSec $TimeoutSec
}

function Convert-ToHashtable {
  param([Parameter(Mandatory = $false)]$Object)

  if ($null -eq $Object) {
    return $null
  }

  if ($Object -is [hashtable]) {
    return @{} + $Object
  }

  if ($Object -isnot [psobject]) {
    return $null
  }

  $h = @{}
  foreach ($prop in $Object.PSObject.Properties) {
    $h[$prop.Name] = $prop.Value
  }
  return $h
}

function Normalize-ApiLocations {
  param([Parameter(Mandatory = $false)]$Raw)

  if ($null -eq $Raw) { return @() }
  if ($Raw -is [System.Array]) { return @($Raw) }
  if ($Raw.PSObject.Properties.Name -contains 'items' -and $null -ne $Raw.items) { return @($Raw.items) }
  if ($Raw.PSObject.Properties.Name -contains 'locations' -and $null -ne $Raw.locations) { return @($Raw.locations) }
  return @()
}

function Find-LocationRawById {
  param(
    [Parameter(Mandatory = $false)]$Raw,
    [Parameter(Mandatory = $true)][string]$LocationId
  )

  $items = Normalize-ApiLocations -Raw $Raw
  foreach ($item in $items) {
    $itemId = "$($item.id)"
    if ($itemId -eq $LocationId) {
      return (Convert-ToHashtable -Object $item)
    }
  }

  return $null
}

function Get-ExistingLocationRawForUpdate {
  param(
    [Parameter(Mandatory = $true)][string]$LocationsUrl,
    [Parameter(Mandatory = $true)][string]$LocationId
  )

  try {
    $raw = Invoke-ApiJson -Method GET -Uri "$LocationsUrl/$LocationId"
    if ($raw -is [System.Array]) {
      $found = Find-LocationRawById -Raw $raw -LocationId $LocationId
      if ($null -ne $found) { return $found }
      if ($raw.Count -gt 0) { return (Convert-ToHashtable -Object $raw[0]) }
      return $null
    }

    $wrappedFound = Find-LocationRawById -Raw $raw -LocationId $LocationId
    if ($null -ne $wrappedFound) { return $wrappedFound }

    if ($raw.PSObject.Properties.Name -contains 'item' -and $null -ne $raw.item) {
      return (Convert-ToHashtable -Object $raw.item)
    }

    if ($raw.PSObject.Properties.Name -contains 'location' -and $null -ne $raw.location) {
      return (Convert-ToHashtable -Object $raw.location)
    }

    return (Convert-ToHashtable -Object $raw)
  }
  catch {
    Write-WarnMsg "GET $LocationsUrl/$LocationId failed. Falling back to GET $LocationsUrl. $($_.Exception.Message)"
  }

  try {
    $allRaw = Invoke-ApiJson -Method GET -Uri $LocationsUrl
    return Find-LocationRawById -Raw $allRaw -LocationId $LocationId
  }
  catch {
    Write-WarnMsg "GET $LocationsUrl fallback failed for location id=$LocationId. $($_.Exception.Message)"
    return $null
  }
}

function Get-UpdatesFromFile {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Input file not found: $Path"
  }

  $rawJson = Get-Content -LiteralPath $Path -Raw
  $parsed = $rawJson | ConvertFrom-Json

  if ($parsed -is [System.Array]) {
    return @($parsed)
  }

  if ($parsed.PSObject.Properties.Name -contains 'items' -and $parsed.items) {
    return @($parsed.items)
  }

  throw "Input JSON must be an array or an object with an 'items' array."
}

function Build-LocationUpdatePayload {
  param(
    [Parameter(Mandatory = $true)]$Update,
    [Parameter(Mandatory = $false)][hashtable]$ExistingRaw
  )

  $base = @{}
  if ($null -ne $ExistingRaw) {
    $base = @{} + $ExistingRaw
  }

  $incomingName = "$($Update.name)".Trim()
  $existingName = "$($base.name)".Trim()
  if ([string]::IsNullOrWhiteSpace($existingName)) {
    $existingName = "$($base.locationName)".Trim()
  }

  $latValue = $null
  if ($base.ContainsKey('latitude') -and $null -ne $base.latitude -and "$($base.latitude)".Trim() -ne '') {
    $latValue = [double]$base.latitude
  }
  elseif ($base.ContainsKey('lat') -and $null -ne $base.lat -and "$($base.lat)".Trim() -ne '') {
    $latValue = [double]$base.lat
  }

  $lngValue = $null
  if ($base.ContainsKey('longitude') -and $null -ne $base.longitude -and "$($base.longitude)".Trim() -ne '') {
    $lngValue = [double]$base.longitude
  }
  elseif ($base.ContainsKey('lng') -and $null -ne $base.lng -and "$($base.lng)".Trim() -ne '') {
    $lngValue = [double]$base.lng
  }

  $payload = [ordered]@{
    name = $(if ([string]::IsNullOrWhiteSpace($incomingName)) { $existingName } else { $incomingName })
  }

  if ($null -ne $latValue) {
    $payload['latitude'] = $latValue
  }
  if ($null -ne $lngValue) {
    $payload['longitude'] = $lngValue
  }

  return $payload
}

function Test-NameMatchesExpected {
  param(
    [Parameter(Mandatory = $false)]$ActualRaw,
    [Parameter(Mandatory = $true)]$ExpectedUpdate
  )

  $actual = (Convert-ToHashtable -Object $ActualRaw)
  $actualName = "$($actual.name)".Trim()
  if ([string]::IsNullOrWhiteSpace($actualName)) {
    $actualName = "$($actual.locationName)".Trim()
  }

  $expectedName = "$($ExpectedUpdate.name)".Trim()
  return @{
    ok = ($actualName -eq $expectedName)
    actualName = $actualName
    expectedName = $expectedName
  }
}

if ([string]::IsNullOrWhiteSpace($BearerToken)) {
  throw "Missing bearer token. Pass -BearerToken or set BP_API_TOKEN."
}

$trimmedBaseUrl = $BaseUrl.TrimEnd('/')
$locationsUrl = "$trimmedBaseUrl/Locations"
$updates = Get-UpdatesFromFile -Path $InputFile

Write-Info "Loaded $($updates.Count) location updates from $InputFile"
Write-Info "Target endpoint: PUT $locationsUrl/{id}"
if ($DryRun) {
  Write-Info "DryRun enabled: no PUT requests will be sent."
}

$successCount = 0
$failCount = 0
$results = New-Object System.Collections.Generic.List[object]

foreach ($update in $updates) {
  $locationId = "$($update.id)".Trim()
  $name = "$($update.name)".Trim()

  if ([string]::IsNullOrWhiteSpace($locationId)) {
    $failCount++
    Write-WarnMsg "Skipping row with missing id."
    continue
  }

  try {
    $existingRaw = Get-ExistingLocationRawForUpdate -LocationsUrl $locationsUrl -LocationId $locationId
    if ($null -eq $existingRaw) {
      throw "Location not found"
    }

    $beforeMatch = Test-NameMatchesExpected -ActualRaw $existingRaw -ExpectedUpdate $update
    $action = 'unchanged'
    $afterRaw = $existingRaw

    if (-not $DryRun -and -not $beforeMatch.ok) {
      $payload = Build-LocationUpdatePayload -Update $update -ExistingRaw $existingRaw
      [void](Invoke-ApiJson -Method PUT -Uri "$locationsUrl/$locationId" -Body $payload)
      $action = 'updated'
      $afterRaw = Get-ExistingLocationRawForUpdate -LocationsUrl $locationsUrl -LocationId $locationId
    }
    elseif ($DryRun -and -not $beforeMatch.ok) {
      $action = 'would_update'
    }

    $afterMatch = Test-NameMatchesExpected -ActualRaw $afterRaw -ExpectedUpdate $update
    if (-not $afterMatch.ok) {
      throw "Verification failed. expected='$($afterMatch.expectedName)' actual='$($afterMatch.actualName)'"
    }

    if ($action -eq 'updated') {
      Write-Info "Updated location id=$locationId name='$name'"
    }
    elseif ($action -eq 'would_update') {
      Write-Info "DRY RUN id=$locationId name='$name'"
    }

    $successCount++
    $results.Add([pscustomobject]@{
      id = $locationId
      name = $name
      status = 'success'
      action = $action
    }) | Out-Null
  }
  catch {
    $failCount++
    $message = $_.Exception.Message
    Write-WarnMsg "Failed location id=$locationId name='$name'. $message"
    $results.Add([pscustomobject]@{
      id = $locationId
      name = $name
      status = 'failed'
      error = $message
    }) | Out-Null

    if ($StopOnError) {
      throw
    }
  }
}

Write-Host ""
Write-Host "Summary: success=$successCount failed=$failCount total=$($updates.Count)"
$results | Format-Table -AutoSize
