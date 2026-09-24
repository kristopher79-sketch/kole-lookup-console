'use strict';

// Only business fields exposed by the driver card. Account access, termination,
// status and automation-owned fields are intentionally outside this editor.
const DRIVER_ROSTER_EDIT_FIELDS = [
  ['tmsName', 'TMSName', 'TMS Name', 'Driver / Contact'],
  ['operatorTeamName', 'Operator_x002f_TeamName', 'Operator / Team', 'Driver / Contact'],
  ['truck', 'Trucks', 'Truck', 'Driver / Contact', 'text', 17],
  ['cellPhone1', 'CellPhone1', 'Cell Phone 1', 'Driver / Contact'],
  ['cellPhone2', 'CellPhone2', 'Cell Phone 2', 'Driver / Contact'],
  ['emailAddress1', 'EmailAddress1', 'Email Address 1', 'Driver / Contact', 'email'],
  ['emailAddress2', 'EmailAddress2', 'Email Address 2', 'Driver / Contact', 'email'],
  ['startDate', 'StartDate', 'Start Date', 'Driver / Contact', 'date'],
  ['driverType', 'DriverType', 'Driver Type', 'Operational'],
  ['soloOrTeam', 'SoloorTeam', 'Function', 'Operational'],
  ['bolLetterPrefix', 'BOLLetterPrefix', 'BOL Prefix', 'Operational'],
  ['trailerType', 'TrailerType', 'Trailer Type', 'Operational'],
  ['registeredWeight', 'RegisteredWeight', 'Registered Weight', 'Operational', 'number'],
  ['tractorPlate', 'TractorPlate', 'Plate', 'Tractor'],
  ['tractorYear', 'TractorYear', 'Year', 'Tractor', 'year'],
  ['tractorMake', 'TractorMake', 'Make', 'Tractor'],
  ['tractorVin', 'TractorVIN', 'VIN', 'Tractor', 'text', 17],
  ['tractorOwner', 'TractorOwner', 'Owner', 'Tractor'],
  ['tractorRegisteredState', 'TractorRegisteredState', 'Registered State', 'Tractor'],
  ['tractorAxles', 'TractorAxles', 'Axles', 'Tractor', 'integer'],
  ['trailerUnitNumber', 'TrailerUnitNumber', 'Unit', 'Trailer', 'text', 17],
  ['trailerLength', 'TrailerLength', 'Length', 'Trailer'],
  ['trailerPlate', 'TrailerPlate', 'Plate', 'Trailer'],
  ['trailerRegisteredState', 'TrailerRegisteredState', 'Registered State', 'Trailer'],
  ['trailerYear', 'TrailerYear', 'Year', 'Trailer', 'year'],
  ['trailerMake', 'TrailerMake', 'Make', 'Trailer'],
  ['trailerVin', 'TrailerVIN', 'VIN', 'Trailer', 'text', 17],
  ['trailerOwner', 'TrailerOwner', 'Owner', 'Trailer'],
  ['trailerAxles', 'TrailerAxles', 'Axles', 'Trailer', 'integer'],
  ['emptyWeight', 'EmptyWeight', 'Empty Weight', 'Dimensions / Weight', 'number'],
  ['steerAxleWeight', 'SteerAxleWeight', 'Steer Axle Weight', 'Dimensions / Weight', 'number'],
  ['overallLength', 'OverallLength', 'Overall Length', 'Dimensions / Weight', 'number'],
  ['lowestDeckHeight', 'LowestDeckHeight', 'Lowest Deck Height', 'Dimensions / Weight', 'number'],
  ['spacing1to2', 'Spacing1to2', 'Spacing 1 to 2', 'Dimensions / Weight', 'number'],
  ['spacing2to3', 'Spacing2to3', 'Spacing 2 to 3', 'Dimensions / Weight', 'number'],
  ['spacing3to4', 'Spacing3to4', 'Spacing 3 to 4', 'Dimensions / Weight', 'number'],
  ['spacing4to5', 'Spacing4to5', 'Spacing 4 to 5', 'Dimensions / Weight', 'number']
].map(([key, field, label, group, kind = 'text', maxLength = 255]) => Object.freeze({ key, field, label, group, kind, maxLength }));
const FUNCTION_CHOICES = ['Solo', 'Team', 'Absentee - Solo', 'Absentee - Team'];

function driverRosterEditError(message, statusCode = 400, code = 'DRIVER_ROSTER_INVALID_EDIT') {
  return Object.assign(new Error(message), { statusCode, safeForClient: true, code });
}

function buildDriverRosterEditSchema(columns) {
  const byName = new Map(columns.map((column) => [column.name, column]));
  return DRIVER_ROSTER_EDIT_FIELDS.map((definition) => {
    const column = byName.get(definition.field);
    const numeric = ['number', 'integer', 'year'].includes(definition.kind);
    const storageType = column?.choice ? 'choice' : column?.text ? 'text' : column?.number ? 'number' : column?.dateTime ? 'date' : '';
    const compatible = definition.kind === 'date' ? storageType === 'date'
      : numeric ? ['text', 'number'].includes(storageType) : ['text', 'choice'].includes(storageType);
    let disabledReason = !column ? 'This field is unavailable in the roster.'
      : column.readOnly || column.hidden ? 'This field is read-only.'
        : !compatible || column.choice?.displayAs === 'checkBoxes' ? 'This field cannot be edited here.' : '';
    let choices = storageType === 'choice' ? [...(column.choice.choices || [])] : null;
    if (definition.key === 'soloOrTeam') choices = choices ? choices.filter((value) => FUNCTION_CHOICES.includes(value)) : FUNCTION_CHOICES;
    if (choices && choices.length === 0 && !disabledReason) disabledReason = 'No approved choices are available.';
    return {
      ...definition, storageType, choices, disabledReason,
      required: column?.required === true || definition.key === 'truck',
      maxLength: Math.min(definition.maxLength, column?.text?.maxLength || definition.maxLength),
      minimum: column?.number?.minimum ?? null,
      maximum: column?.number?.maximum ?? null
    };
  });
}

function isRealDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}

function buildDriverRosterEditPatch(changes, columns, currentFields = {}) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw driverRosterEditError('Provide the fields to update.');
  const schema = new Map(buildDriverRosterEditSchema(columns).map((field) => [field.key, field]));
  const patch = {};
  for (const [key, raw] of Object.entries(changes)) {
    const field = schema.get(key);
    if (!field) throw driverRosterEditError('The request includes a field that cannot be edited here.');
    if (field.disabledReason) throw driverRosterEditError(`${field.label}: ${field.disabledReason}`);
    if (raw !== null && !['string', 'number'].includes(typeof raw)) throw driverRosterEditError(`${field.label} has an invalid value.`);
    const text = raw == null ? '' : String(raw).trim();
    if (field.required && !text) throw driverRosterEditError(`${field.label} is required.`);
    if (text.length > field.maxLength) throw driverRosterEditError(`${field.label} must be at most ${field.maxLength} characters.`);
    let value = text;
    if (['number', 'integer', 'year'].includes(field.kind)) {
      if (!text) value = field.storageType === 'number' ? null : '';
      else {
        if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) throw driverRosterEditError(`${field.label} must be a non-negative number.`);
        const number = Number(text.replace(/,/g, ''));
        if (!Number.isFinite(number) || number > Number.MAX_SAFE_INTEGER ||
            (field.kind !== 'number' && !Number.isInteger(number)) ||
            (field.minimum !== null && number < field.minimum) || (field.maximum !== null && number > field.maximum)) {
          throw driverRosterEditError(`${field.label} is outside the supported range.`);
        }
        value = field.storageType === 'number' ? number : text.replace(/,/g, '');
      }
    } else if (field.kind === 'date') {
      if (text && !isRealDateOnly(text)) throw driverRosterEditError(`${field.label} must be a valid calendar date.`);
      const termDate = String(currentFields.TermDate || '').slice(0, 10);
      if (text && termDate && text > termDate) throw driverRosterEditError('Start Date cannot be after the termination date.');
      value = text || null;
    } else if (text && field.kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
      throw driverRosterEditError(`${field.label} must be a valid email address.`);
    }
    if (field.choices && text && !field.choices.includes(text)) throw driverRosterEditError(`${field.label} must use an approved choice.`);
    patch[field.field] = value;
  }
  if ((Object.hasOwn(changes, 'tmsName') || Object.hasOwn(changes, 'operatorTeamName')) &&
      !String(patch.TMSName ?? currentFields.TMSName ?? '').trim() &&
      !String(patch.Operator_x002f_TeamName ?? currentFields.Operator_x002f_TeamName ?? '').trim()) {
    throw driverRosterEditError('TMS Name or Operator / Team is required.');
  }
  return patch;
}

module.exports = { DRIVER_ROSTER_EDIT_FIELDS, buildDriverRosterEditSchema, buildDriverRosterEditPatch, driverRosterEditError };
