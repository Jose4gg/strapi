'use strict';

module.exports = ({ strapi }) => {
  return {
    buildAssociationResolver({ contentTypeUID, attributeName }) {
      return async (parent, args = {}, context = {}) => {
        return context[`association::${contentTypeUID}`]
          .init({
            contentTypeUID,
            attributeName,
            strapi,
          })
          .load({ parent, args, context });
      };
    },
  };
};
