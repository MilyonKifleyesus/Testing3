[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$BaseUrl = 'https://api.fleetpulse.net/api',

  [Parameter(Mandatory = $false)]
  [string]$InputFile = 'scripts/client-updates.by-id.json',

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

# Windows PowerShell may default to older TLS protocols that fail against modern APIs.
try {
  $tls = [System.Net.SecurityProtocolType]::Tls12
  if ([Enum]::GetNames([System.Net.SecurityProtocolType]) -contains 'Tls13') {
    $tls = $tls -bor [System.Net.SecurityProtocolType]::Tls13
  }
  [System.Net.ServicePointManager]::SecurityProtocol = $tls
}
catch {
  # Ignore if the runtime does not expose these protocol flags.
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

function Normalize-ApiClients {
  param([Parameter(Mandatory = $false)]$Raw)

  if ($null -eq $Raw) {
    return @()
  }

  if ($Raw -is [System.Array]) {
    return @($Raw)
  }

  if ($Raw.PSObject.Properties.Name -contains 'items' -and $null -ne $Raw.items) {
    return @($Raw.items)
  }

  if ($Raw.PSObject.Properties.Name -contains 'clients' -and $null -ne $Raw.clients) {
    return @($Raw.clients)
  }

  return @()
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

function Find-ClientRawById {
  param(
    [Parameter(Mandatory = $false)]$Raw,
    [Parameter(Mandatory = $true)][string]$ClientId
  )

  $items = Normalize-ApiClients -Raw $Raw
  foreach ($item in $items) {
    $itemId = "$($item.clientId)"
    if ([string]::IsNullOrWhiteSpace($itemId)) {
      $itemId = "$($item.id)"
    }

    if ($itemId -eq $ClientId) {
      return (Convert-ToHashtable -Object $item)
    }
  }

  return $null
}

function Get-ExistingClientRawForUpdate {
  param(
    [Parameter(Mandatory = $true)][string]$ClientsUrl,
    [Parameter(Mandatory = $true)][string]$ClientId
  )

  try {
    $raw = Invoke-ApiJson -Method GET -Uri "$ClientsUrl/$ClientId"

    if ($raw -is [System.Array]) {
      $found = Find-ClientRawById -Raw $raw -ClientId $ClientId
      if ($null -ne $found) { return $found }
      if ($raw.Count -gt 0) { return (Convert-ToHashtable -Object $raw[0]) }
      return $null
    }

    $wrappedFound = Find-ClientRawById -Raw $raw -ClientId $ClientId
    if ($null -ne $wrappedFound) { return $wrappedFound }

    if ($raw.PSObject.Properties.Name -contains 'item' -and $null -ne $raw.item) {
      return (Convert-ToHashtable -Object $raw.item)
    }

    if ($raw.PSObject.Properties.Name -contains 'client' -and $null -ne $raw.client) {
      return (Convert-ToHashtable -Object $raw.client)
    }

    return (Convert-ToHashtable -Object $raw)
  }
  catch {
    Write-WarnMsg "GET $ClientsUrl/$ClientId failed. Falling back to GET $ClientsUrl. $($_.Exception.Message)"
  }

  try {
    $allRaw = Invoke-ApiJson -Method GET -Uri $ClientsUrl
    return Find-ClientRawById -Raw $allRaw -ClientId $ClientId
  }
  catch {
    Write-WarnMsg "GET $ClientsUrl fallback failed for client id=$ClientId. $($_.Exception.Message)"
    return $null
  }
}

function Get-ValueOrDefault {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Table,
    [Parameter(Mandatory = $true)][string[]]$Keys,
    [Parameter(Mandatory = $false)]$Default = $null
  )

  foreach ($key in $Keys) {
    if ($Table.ContainsKey($key) -and $null -ne $Table[$key]) {
      return $Table[$key]
    }
  }

  return $Default
}

function Build-ClientUpdatePayload {
  param(
    [Parameter(Mandatory = $true)][string]$ClientId,
    [Parameter(Mandatory = $true)]$Update,
    [Parameter(Mandatory = $false)][hashtable]$ExistingRaw
  )

  $base = @{}
  if ($null -ne $ExistingRaw) {
    $base = @{} + $ExistingRaw
  }

  $incomingName = "$($Update.customerName)".Trim()
  $existingCustomerName = Get-ValueOrDefault -Table $base -Keys @('customerName', 'clientName', 'name') -Default $incomingName
  $existingCustomerLogo = Get-ValueOrDefault -Table $base -Keys @('customerLogo') -Default $null
  $existingCustomerLogoName = Get-ValueOrDefault -Table $base -Keys @('customerLogoName') -Default $null
  $existingLocationId = Get-ValueOrDefault -Table $base -Keys @('locationId', 'LocationId') -Default $null
  $idValue = Get-ValueOrDefault -Table $base -Keys @('id') -Default $ClientId
  $clientIdValue = Get-ValueOrDefault -Table $base -Keys @('clientId') -Default $ClientId

  return [ordered]@{
    id = $idValue
    clientId = $clientIdValue
    customerName = $(if ([string]::IsNullOrWhiteSpace($incomingName)) { $existingCustomerName } else { $incomingName })
    customerLogo = $existingCustomerLogo
    customerLogoName = $existingCustomerLogoName
    locationId = $existingLocationId
    latitude = [double]$Update.latitude
    longitude = [double]$Update.longitude
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

$trimmedBaseUrl = $BaseUrl.TrimEnd('/')
$clientsUrl = "$trimmedBaseUrl/Clients"
$updates = Get-UpdatesFromFile -Path $InputFile

Write-Info "Loaded $($updates.Count) client updates from $InputFile"
Write-Info "Target endpoint: PUT $clientsUrl/{id}"
if ($DryRun) {
  Write-Info "DryRun enabled: no PUT requests will be sent."
}

$successCount = 0
$failCount = 0
$results = New-Object System.Collections.Generic.List[object]

foreach ($update in $updates) {
  $clientId = "$($update.id)".Trim()
  $name = "$($update.customerName)".Trim()

  if ([string]::IsNullOrWhiteSpace($clientId)) {
    $failCount++
    Write-WarnMsg "Skipping row with missing id."
    continue
  }

  try {
    if ($null -eq $update.latitude -or $null -eq $update.longitude) {
      throw "Missing latitude/longitude for id=$clientId"
    }

    $existingRaw = Get-ExistingClientRawForUpdate -ClientsUrl $clientsUrl -ClientId $clientId
    $payload = Build-ClientUpdatePayload -ClientId $clientId -Update $update -ExistingRaw $existingRaw

    if ($DryRun) {
      Write-Info "DRY RUN id=$clientId name='$name' lat=$($payload.latitude) lng=$($payload.longitude)"
    }
    else {
      [void](Invoke-ApiJson -Method PUT -Uri "$clientsUrl/$clientId" -Body $payload)
      Write-Info "Updated client id=$clientId name='$name'"
    }

    $successCount++
    $results.Add([pscustomobject]@{
      id = $clientId
      customerName = $name
      status = 'success'
    }) | Out-Null
  }
  catch {
    $failCount++
    $message = $_.Exception.Message
    Write-WarnMsg "Failed client id=$clientId name='$name'. $message"
    $results.Add([pscustomobject]@{
      id = $clientId
      customerName = $name
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
