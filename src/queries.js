// GraphQL operation strings, reverse-engineered from the Forkable Member Console SPA.
// See notes/api-spec.md for provenance.

export const ME_BASIC = `query { me {
  id firstName lastName fullName email phone
  mfaEnabled mealClubAutoOrder active likes dislikes restrictions tips
  companies { id }
  mealClubs { id forBuffet forFamily userRoles }
} }`;

export const ME_CLUBS = `query { me {
  mealClubs { id forBuffet forFamily userRoles }
  preferredLocations { wday clubId }
} }`;

// One delivery per scheduled meal day for the week beginning `from`.
export const myDeliveries = (from) => `query { myDeliveries(from: "${from}") {
  id forDeliveryAt state simpleState deliveryWindow isReadOnly userConfirmed
  canRequestChanges pastLateOrderDeadline availableMenuIds
  address { formatted }
  club { id name copay hidePrices hiddenPriceLimit allowanceType }
  orders {
    id state total
    pieces {
      id date itemId menuId name userId userFullName state autoOrder
      instructions selections price description ingredients dietLevel
    }
  }
  userReceipt { id subtotal due copayAmount }
} }`;

// Full menu(s) for a club. `ids` may be a single int or a JSON array of ints.
export const menus = (ids, clubId) => {
  const idArg = Array.isArray(ids) ? `[${ids.join(',')}]` : `${ids}`;
  return `query { menus(ids: ${idArg}, clubId: ${clubId}) {
    id name displayName disableSpecialInstructions ratingCount
    venue { id name displayName capacity }
    sections { id name description items {
      id menuId name description price ingredientTags modifierIds imageUrl
      averageRating dietLevel
      modifiers { id name optionSetId min max free required options { id name price ingredientTags } }
    } }
  } }`;
};

// Forkable's own per-item recommendation score for a user on a delivery.
export const mealGenerationScores = (deliveryId, userId, menuIds) =>
  `query { mealGenerationScores(deliveryId: ${deliveryId}, userId: ${userId}, menuIds: [${menuIds.join(',')}]) { menuId itemId score } }`;

// Dietary-conflict check for a candidate item + modifier selection.
export const mealRestrictions = (userId, menuId, itemId, customizationJson) =>
  `query { mealRestrictions(userId: ${userId}, menuId: ${menuId}, itemId: ${itemId}, customization: ${JSON.stringify(customizationJson)}) { conflicts } }`;

// Pre-auth: tells us whether an email uses SSO or plain password.
export const identities = (email) =>
  `query { identities(email: ${JSON.stringify(email)}) { integration { type provider loginUrl allowSsoPasswordLogin } } }`;

// Return-field selection for the createSession (login) mutation.
export const CREATE_SESSION_FIELDS = `errorAttributes errorDetails user { id firstName lastName email mfaEnabled }`;

// Return-field selection for replacePiece — kept lean; we re-fetch the week after.
export const REPLACE_PIECE_FIELDS = `errors errorDetails warningDetails
  delivery { id forDeliveryAt orders { id pieces { id itemId menuId name price } } }
  userReceipt { id subtotal due copayAmount }`;
