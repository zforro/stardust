export const registerCollection = (collection, name, STARDUST) => {
  if (!collection._name) {
    collection._name = name;
  }
  const collectionName = collection._name;
  
  if (!collectionName) {
    throw new Error(
      "Please name your LocalCollection (2nd argument to registerCollection)."
    );
  };
  
  if (STARDUST.collections[collectionName]) {
    throw new Error(
      `Collection with name ${colletionName} already registered!`
    );
  };
  
  STARDUST.collections[collectionName] = collection;
};
