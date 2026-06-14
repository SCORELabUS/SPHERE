export const TEMPLATE_PETCLINIC_PRICING = `saasName: PetClinic
syntaxVersion: "3.1"
version: "1.0.0"
createdAt: "2025-09-19"
currency: EUR
features:
  pets:
    description: Pets description
    valueType: BOOLEAN
    defaultValue: true
    expression: pricingContext['features']['pets'] && subscriptionContext['maxPets'] < pricingContext['usageLimits']['maxPets']
    serverExpression: pricingContext['features']['pets'] && subscriptionContext['maxPets'] <= pricingContext['usageLimits']['maxPets']
    type: DOMAIN
  visits:
    description: visits description
    valueType: BOOLEAN
    defaultValue: true
    expression: pricingContext['features']['visits'] && subscriptionContext['maxVisitsPerMonthAndPet'] < pricingContext['usageLimits']['maxVisitsPerMonthAndPet']
    serverExpression: pricingContext['features']['visits'] && subscriptionContext['maxVisitsPerMonthAndPet'] <= pricingContext['usageLimits']['maxVisitsPerMonthAndPet']
    type: DOMAIN
  supportPriority:
    description: supportPriority description
    valueType: TEXT
    defaultValue: LOW
    type: SUPPORT
  haveCalendar:
    description: haveCalendar description
    valueType: BOOLEAN
    defaultValue: false
    expression: pricingContext['features']['haveCalendar']
    type: DOMAIN
  havePetsDashboard:
    description: havePetsDashboard description
    valueType: BOOLEAN
    defaultValue: false
    expression: pricingContext['features']['havePetsDashboard']
    type: DOMAIN
    render: disabled
  haveVetSelection:
    description: haveVetSelection description
    valueType: BOOLEAN
    defaultValue: false
    expression: pricingContext['features']['haveVetSelection']
    type: DOMAIN
  consultations:
    description: consultations description
    valueType: BOOLEAN
    defaultValue: false
    expression: pricingContext['features']['consultations']
    type: DOMAIN
  smartClinicReports:
    description: smartClinicReports description
    valueType: BOOLEAN
    defaultValue: false
    type: INFORMATION
    render: disabled
  petAdoptionCentre:
    description: petAdoptionCentre description
    valueType: BOOLEAN
    defaultValue: false
    type: DOMAIN
    render: disabled
usageLimits:
  maxPets:
    description: ''
    valueType: NUMERIC
    defaultValue: 2
    unit: pet
    type: NON_RENEWABLE
    trackable: true
    linkedFeatures:
    - pets
  maxVisitsPerMonthAndPet:
    description: ''
    valueType: NUMERIC
    defaultValue: 1
    unit: visit
    type: RENEWABLE
    period:
      value: 1
      unit: MONTH
    linkedFeatures:
    - visits
plans:
  BASIC:
    description: Basic plan
    price: 0.0
    unit: user/month
    features: null
    usageLimits: null
  GOLD:
    description: Advanced plan
    price: 5.0
    unit: user/month
    features:
      supportPriority:
        value: MEDIUM
      haveCalendar:
        value: true
      haveVetSelection:
        value: true
      consultations:
        value: false
    usageLimits:
      maxPets:
        value: 4
      maxVisitsPerMonthAndPet:
        value: 3
  PLATINUM:
    description: Pro plan
    price: 10.0
    unit: user/month
    features:
      supportPriority:
        value: HIGH
      haveCalendar:
        value: true
      haveVetSelection:
        value: true
      consultations:
        value: true
    usageLimits:
      maxPets:
        value: 7
      maxVisitsPerMonthAndPet:
        value: 6
addOns:
  extraPet:
    description: extraPet description
    price: 2.95
    unit: pet/month
    subscriptionConstraints:
      min: 1
      max: 20
      step: 1
    usageLimitsExtensions:
      maxPets:
        value: 1
  havePetsDashboard:
    description: havePetsDashboard description
    availableFor:
      - PLATINUM
    price: 5.95
    unit: user/month
    features:
      havePetsDashboard:
        value: true
  smartClinicReports:
    description: smartClinicReports description
    dependsOn:
      - havePetsDashboard
    price: 3.95
    unit: user/month
    features:
      smartClinicReports:
        value: true
  petAdoptionCentre:
    description: petAdoptionCentre description
    price: 15.95
    unit: user/month
    features:
      petAdoptionCentre:
        value: true
`