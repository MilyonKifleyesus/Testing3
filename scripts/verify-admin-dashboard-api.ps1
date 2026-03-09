[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Get-RequiredEnv {
  param([Parameter(Mandatory = $true)][string]$Name)

  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Missing required environment variable: $Name"
  }

  return $value
}

function Get-OptionalEnv {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$DefaultValue
  )

  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $DefaultValue
  }

  return $value
}

function Read-ErrorResponseBody {
  param([Parameter(Mandatory = $true)]$ErrorRecord)

  try {
    if ($ErrorRecord.Exception.Response -and $ErrorRecord.Exception.Response.GetResponseStream) {
      $stream = $ErrorRecord.Exception.Response.GetResponseStream()
      if ($stream) {
        $reader = New-Object System.IO.StreamReader($stream)
        $content = $reader.ReadToEnd()
        $reader.Close()
        return $content
      }
    }
  } catch {
    # no-op
  }

  try {
    $details = $ErrorRecord.ErrorDetails.Message
    if (-not [string]::IsNullOrWhiteSpace($details)) {
      return $details
    }
  } catch {
    # no-op
  }

  return ''
}

function Invoke-JsonRequest {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('GET', 'POST')][string]$Method,
    [Parameter(Mandatory = $true)][string]$Uri,
    [hashtable]$Headers,
    [object]$Body
  )

  $invokeParams = @{
    Method      = $Method
    Uri         = $Uri
    ErrorAction = 'Stop'
  }

  if ($Headers) {
    $invokeParams['Headers'] = $Headers
  }

  if ($null -ne $Body) {
    $invokeParams['ContentType'] = 'application/json'
    $invokeParams['Body'] = ($Body | ConvertTo-Json -Depth 20 -Compress)
  }

  try {
    $response = Invoke-WebRequest @invokeParams
    $parsed = $null

    if (-not [string]::IsNullOrWhiteSpace($response.Content)) {
      try {
        $parsed = $response.Content | ConvertFrom-Json
      } catch {
        $parsed = $response.Content
      }
    }

    return [pscustomobject]@{
      ok         = $true
      statusCode = [int]$response.StatusCode
      uri        = $Uri
      body       = $parsed
      rawBody    = $response.Content
      error      = $null
    }
  } catch {
    $statusCode = 0

    try {
      if ($_.Exception.Response -and $null -ne $_.Exception.Response.StatusCode) {
        $statusCode = [int]$_.Exception.Response.StatusCode
      }
    } catch {
      # no-op
    }

    $rawBody = Read-ErrorResponseBody -ErrorRecord $_
    $parsed = $null
    if (-not [string]::IsNullOrWhiteSpace($rawBody)) {
      try {
        $parsed = $rawBody | ConvertFrom-Json
      } catch {
        $parsed = $rawBody
      }
    }

    return [pscustomobject]@{
      ok         = $false
      statusCode = $statusCode
      uri        = $Uri
      body       = $parsed
      rawBody    = $rawBody
      error      = $_.Exception.Message
    }
  }
}

function Get-CollectionProbe {
  param([object]$Body)

  if ($null -eq $Body) {
    return [pscustomobject]@{ isCollection = $false; items = @() }
  }

  if ($Body -is [System.Array]) {
    return [pscustomobject]@{ isCollection = $true; items = @($Body) }
  }

  $propertyNames = @($Body.PSObject.Properties.Name)

  if ($propertyNames -contains 'items' -and $Body.items -is [System.Array]) {
    return [pscustomobject]@{ isCollection = $true; items = @($Body.items) }
  }

  if ($propertyNames -contains 'data') {
    if ($Body.data -is [System.Array]) {
      return [pscustomobject]@{ isCollection = $true; items = @($Body.data) }
    }

    if ($Body.data -and ($Body.data.PSObject.Properties.Name -contains 'items') -and $Body.data.items -is [System.Array]) {
      return [pscustomobject]@{ isCollection = $true; items = @($Body.data.items) }
    }
  }

  if ($propertyNames -contains 'projects' -and $Body.projects -is [System.Array]) {
    return [pscustomobject]@{ isCollection = $true; items = @($Body.projects) }
  }

  if ($propertyNames -contains 'vehicles' -and $Body.vehicles -is [System.Array]) {
    return [pscustomobject]@{ isCollection = $true; items = @($Body.vehicles) }
  }

  return [pscustomobject]@{ isCollection = $false; items = @() }
}

function Assert-CollectionShape {
  param(
    [Parameter(Mandatory = $true)][object]$Body,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $probe = Get-CollectionProbe -Body $Body
  if (-not $probe.isCollection) {
    throw "$Label did not return an array-like payload (items/data array expected)."
  }
}

$username = Get-RequiredEnv -Name 'BP_TEST_USERNAME'
$password = Get-RequiredEnv -Name 'BP_TEST_PASSWORD'
$baseUrl = (Get-OptionalEnv -Name 'BP_BASE_URL' -DefaultValue 'http://localhost:4200').TrimEnd('/')
$projectId = Get-OptionalEnv -Name 'BP_PROJECT_ID' -DefaultValue '53'
$apiBaseUrl = "$baseUrl/api"

Write-Host "[verify:admin:api] Base URL: $baseUrl"
Write-Host "[verify:admin:api] Project ID: $projectId"

$loginResponse = Invoke-JsonRequest -Method 'POST' -Uri "$apiBaseUrl/auth/login" -Body @{
  usernameOrEmail = $username
  password        = $password
}

if (-not $loginResponse.ok -or $loginResponse.statusCode -ne 200) {
  $detail = if ($loginResponse.rawBody) { $loginResponse.rawBody } else { $loginResponse.error }
  throw "Authentication failed ($($loginResponse.statusCode)): $detail"
}

$accessToken = [string]$loginResponse.body.accessToken
$userId = $loginResponse.body.userId

if ([string]::IsNullOrWhiteSpace($accessToken)) {
  throw 'Authentication succeeded but accessToken was missing in response.'
}

if ($null -eq $userId -or [string]::IsNullOrWhiteSpace([string]$userId)) {
  throw 'Authentication succeeded but userId was missing in response.'
}

$headers = @{
  Authorization = "Bearer $accessToken"
  Accept        = 'application/json'
}

$checks = @(
  [pscustomobject]@{
    name      = 'Projects'
    uri       = "$apiBaseUrl/Projects?clientId=0&projectTypeId=0&locationId=0&includeClosed=true"
    validate  = {
      param($response)
      Assert-CollectionShape -Body $response.body -Label 'Projects'
    }
  },
  [pscustomobject]@{
    name      = 'Vehicles'
    uri       = "$apiBaseUrl/Vehicles?clientId=0&page=1&pageSize=1"
    validate  = {
      param($response)
      Assert-CollectionShape -Body $response.body -Label 'Vehicles'
    }
  },
  [pscustomobject]@{
    name      = 'Clients'
    uri       = "$apiBaseUrl/Clients"
    validate  = {
      param($response)
      Assert-CollectionShape -Body $response.body -Label 'Clients'
    }
  },
  [pscustomobject]@{
    name      = 'Manufacturers'
    uri       = "$apiBaseUrl/Manufacturers"
    validate  = {
      param($response)
      Assert-CollectionShape -Body $response.body -Label 'Manufacturers'
    }
  },
  [pscustomobject]@{
    name      = 'Locations'
    uri       = "$apiBaseUrl/Locations"
    validate  = {
      param($response)
      Assert-CollectionShape -Body $response.body -Label 'Locations'
    }
  },
  [pscustomobject]@{
    name      = 'Project Vehicles'
    uri       = "$apiBaseUrl/Projects/$projectId/vehicles?clientId=0&userId=$userId"
    validate  = {
      param($response)
      Assert-CollectionShape -Body $response.body -Label 'Project Vehicles'
    }
  },
  [pscustomobject]@{
    name      = 'Tickets Dashboard'
    uri       = "$apiBaseUrl/tickets/dashboard?projectId=$projectId&userId=$userId"
    validate  = {
      param($response)
      if ($null -eq $response.body) {
        throw 'Tickets Dashboard returned an empty body.'
      }

      $requiredKeys = @('totalTickets', 'repeatedTickets', 'safetyCriticalTickets')
      $availableKeys = @($response.body.PSObject.Properties.Name)
      foreach ($key in $requiredKeys) {
        if (-not ($availableKeys -contains $key)) {
          throw "Tickets Dashboard is missing expected metric key '$key'."
        }
      }
    }
  }
)

$passed = 0
$failed = 0
$failures = New-Object System.Collections.Generic.List[string]

foreach ($check in $checks) {
  $response = Invoke-JsonRequest -Method 'GET' -Uri $check.uri -Headers $headers

  if (-not $response.ok -or $response.statusCode -ne 200) {
    $failed++
    $detail = if ($response.rawBody) { $response.rawBody } else { $response.error }
    $message = "[$($check.name)] HTTP $($response.statusCode) - $detail"
    $failures.Add($message)
    Write-Host "[FAIL] $message" -ForegroundColor Red
    continue
  }

  try {
    & $check.validate $response
    $passed++
    Write-Host "[PASS] $($check.name) (200)"
  } catch {
    $failed++
    $message = "[$($check.name)] Shape validation failed: $($_.Exception.Message)"
    $failures.Add($message)
    Write-Host "[FAIL] $message" -ForegroundColor Red
  }
}

Write-Host "[verify:admin:api] Summary: $passed passed, $failed failed"

if ($failed -gt 0) {
  foreach ($failure in $failures) {
    Write-Host " - $failure" -ForegroundColor Red
  }
  exit 1
}

exit 0
