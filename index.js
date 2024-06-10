addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event));
});

function setNestedObj(obj, path, value) {
  const keys = path.split(".");
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i].replace(/\[\]$/, ""); // Remove [] if present
    current[key] = current[key] || {};
    current = current[key];
  }

  current[keys[keys.length - 1].replace(/\[\]$/, "")] = value;
}

function isEmptyObject(obj) {
  return Object.keys(obj).length === 0 && obj.constructor === Object;
}

function removeEmptyKeys(obj) {
  if (Array.isArray(obj)) {
    return obj.map(removeEmptyKeys).filter((item) => !isEmptyObject(item));
  } else if (typeof obj === "object" && obj !== null) {
    const newObj = {};
    for (const key in obj) {
      if (obj[key] && typeof obj[key] === "object") {
        const cleanedObj = removeEmptyKeys(obj[key]);
        if (!isEmptyObject(cleanedObj)) {
          newObj[key] = cleanedObj;
        }
      } else if (
        obj[key] !== null &&
        obj[key] !== "" &&
        obj[key] !== undefined
      ) {
        newObj[key] = obj[key];
      }
    }
    return newObj;
  } else {
    return obj;
  }
}

async function handleRequest(event) {
  const url = new URL(event.request.url);

  if (url.pathname === "/") {
    return new Response("", {
      status: 302,
      headers: {
        location: "https://github.com/oneezy/opensheet#readme",
      },
    });
  }

  let [id, sheet, ...otherParams] = url.pathname
    .slice(1)
    .split("/")
    .filter((x) => x);

  if (!id || !sheet || otherParams.length > 0) {
    return error("URL format is /spreadsheet_id/sheet_name", 404);
  }

  const cacheKey = `https://opensheet.justinoneill2007.workers.dev/${id}/${sheet}`;
  const cache = caches.default;
  const cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) {
    console.log(`Serving from cache: ${cacheKey}`);
    return cachedResponse;
  } else {
    console.log(`Cache miss: ${cacheKey}`);
  }

  sheet = decodeURIComponent(sheet.replace(/\+/g, " "));

  if (!isNaN(sheet)) {
    if (parseInt(sheet) === 0) {
      return error("For this API, sheet numbers start at 1");
    }

    const sheetData = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}?key=${GOOGLE_API_KEY}`
    ).then((response) => response.json());

    if (sheetData.error) {
      return error(sheetData.error.message);
    }

    const sheetIndex = parseInt(sheet) - 1;
    const sheetWithThisIndex = sheetData.sheets[sheetIndex];

    if (!sheetWithThisIndex) {
      return error(`There is no sheet number ${sheet}`);
    }

    sheet = sheetWithThisIndex.properties.title;
  }

  const result = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${sheet}?key=${GOOGLE_API_KEY}`
  ).then((response) => response.json());

  if (result.error) {
    return error(result.error.message);
  }

  const rawRows = result.values || [];
  const headers = rawRows.shift();
  const aggregatedData = {};
  const arrays = {};

  rawRows.forEach((row) => {
    let rowData = {};
    let hasData = false;

    row.forEach((item, index) => {
      const header = headers[index];
      const match = header.match(/(.*?)\[(.*?)\]/);

      if (match) {
        const [_, arrayPrefix, arrayKey] = match;
        if (!arrays[arrayPrefix]) arrays[arrayPrefix] = [];
        const lastGroup = arrays[arrayPrefix][arrays[arrayPrefix].length - 1];

        if (lastGroup && lastGroup[arrayKey] === undefined) {
          lastGroup[arrayKey] = item;
        } else {
          const newGroup = { [arrayKey]: item };
          arrays[arrayPrefix].push(newGroup);
        }
      } else {
        if (item) {
          setNestedObj(rowData, header, item);
          hasData = true;
        }
      }
    });

    // Only merge rowData if it has data
    if (hasData) {
      for (const key in rowData) {
        setNestedObj(aggregatedData, key, rowData[key]);
      }
    }
  });

  // Add non-empty arrays to aggregatedData
  for (const arrayPrefix in arrays) {
    if (arrays.hasOwnProperty(arrayPrefix)) {
      const filteredArray = arrays[arrayPrefix].filter(
        (item) => !isEmptyObject(item)
      );
      if (filteredArray.length > 0) {
        setNestedObj(aggregatedData, arrayPrefix, filteredArray);
      }
    }
  }

  // Remove empty keys in a second pass
  const cleanedData = removeEmptyKeys(aggregatedData);

  const rows = [cleanedData];

  const apiResponse = new Response(JSON.stringify(rows), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store", // Disable caching for development
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Origin, X-Requested-With, Content-Type, Accept",
    },
  });

  return apiResponse;
}

const error = (message, status = 400) => {
  return new Response(JSON.stringify({ error: message }), {
    status: status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Origin, X-Requested-With, Content-Type, Accept",
    },
  });
};
