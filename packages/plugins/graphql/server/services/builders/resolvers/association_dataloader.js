'use strict';

const { get } = require('lodash/fp');

const utils = require('@strapi/utils');

const { sanitize, pipeAsync } = utils;
const { ApplicationError } = utils.errors;

const Dataloader = require('dataloader');

module.exports = {
  buildAssociationDataloader({ contentTypeUID, attributeName, strapi }) {
    const { service: getGraphQLService } = strapi.plugin('graphql');

    const { isMorphRelation, isMedia } = getGraphQLService('utils').attributes;
    const { transformArgs } = getGraphQLService('builders').utils;
    const { toEntityResponse, toEntityResponseCollection } =
      getGraphQLService('format').returnTypes;

    const contentType = strapi.getModel(contentTypeUID);
    const attribute = contentType.attributes[attributeName];

    if (!attribute) {
      throw new ApplicationError(
        `Failed to build an association resolver for ${contentTypeUID}::${attributeName}`
      );
    }

    const isMediaAttribute = isMedia(attribute);
    const isMorphAttribute = isMorphRelation(attribute);

    const targetUID = isMediaAttribute ? 'plugins::upload.file' : attribute.target;
    const isToMany = isMediaAttribute ? attribute.multiple : attribute.relation.endsWith('Many');

    const targetContentType = strapi.getModel(targetUID);

    return new Dataloader(
      async function resolver(batchArguments) {
        const { args, context } = batchArguments[0];

        const { auth } = context.state;

        const transformedArgs = transformArgs(args, {
          contentType: targetContentType,
          usePagination: true,
        });

        const data = await strapi.entityService.loadMany(
          contentTypeUID,
          batchArguments.map((arg) => arg.parent),
          attributeName,
          transformedArgs
        );

        const info = {
          args: transformedArgs,
          resourceUID: targetUID,
        };

        let results = {};

        // If this a polymorphic association, it sanitizes & returns the raw data
        // Note: The value needs to be wrapped in a fake object that represents its parent
        // so that the sanitize util can work properly.
        if (isMorphAttribute) {
          // Helpers used for the data cleanup
          const wrapData = (dataToWrap) => ({ [attributeName]: dataToWrap });
          const sanitizeData = (dataToSanitize) => {
            return sanitize.contentAPI.output(dataToSanitize, contentType, { auth });
          };
          const unwrapData = get(attributeName);

          // Sanitizer definition
          const sanitizeMorphAttribute = pipeAsync(wrapData, sanitizeData, unwrapData);

          results = data.map((data) => sanitizeMorphAttribute(data));
        } else if (isToMany) {
          // If this is a to-many relation, it returns an object that
          // matches what the entity-response-collection's resolvers expect
          results = data.map((data) => toEntityResponseCollection(data, info));
        } else {
          results = data.map((data) => toEntityResponse(data, info));
        }

        console.warn({
          parents: JSON.stringify(batchArguments.map((arg) => arg.parent)),
          results: JSON.stringify(results),
        });

        return batchArguments.map(({ parent }) => {
          const response = results.find(
            (result) =>
              result?.value?.id === parent.id ||
              result.nodes?.find((node) => node?.id === parent.id)
          );

          console.warn({ response: JSON.stringify(response), parent: JSON.stringify(parent) });

          return response;
        });
      },
      {
        // TODO: Improve logic for args
        cacheKeyFn({ parent, args }) {
          return `${contentTypeUID}::${parent.id}::${JSON.stringify(
            args,
            Object.keys(args).sort()
          )}`;
        },
      }
    );
  },
};
