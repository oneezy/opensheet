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

function parseBracketNotation(obj, path, value) {
  const regex = /(.*?)\[(.*?)\]/;
  let match;
  while ((match = regex.exec(path))) {
    const [, parent, child] = match;
    if (!obj[parent]) obj[parent] = [];
    const index = obj[parent].findIndex((item) => !item.hasOwnProperty(child));
    if (index === -1) {
      const newItem = {};
      newItem[child] = value;
      obj[parent].push(newItem);
    } else {
      obj[parent][index][child] = value;
    }
    path = path.slice(match[0].length);
  }
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

  const cacheKey = `https://opensheet.justinoneill2007.workers.dev/${id}/${encodeURIComponent(
    sheet
  )}`;
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
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(
      sheet
    )}?key=${GOOGLE_API_KEY}`
  ).then((response) => response.json());

  if (result.error) {
    return error(result.error.message);
  }

  const rawRows = result.values || [];
  const headers = rawRows.shift();
  console.log("Headers:", headers);

  // Check if the structure is flat or nested
  const isNested = headers.some(
    (header) => header.includes(".") || header.includes("[")
  );
  console.log("Is Nested:", isNested);

  let data = [];

  if (isNested) {
    data = processNestedJSON(headers, rawRows);
  } else {
    data = processFlatJSON(headers, rawRows);
  }

  const apiResponse = new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `s-maxage=30`,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Origin, X-Requested-With, Content-Type, Accept",
    },
  });

  event.waitUntil(cache.put(cacheKey, apiResponse.clone()));

  return apiResponse;
}

function processFlatJSON(headers, rawRows) {
  const data = [];
  rawRows.forEach((row, rowIndex) => {
    console.log(`Processing row ${rowIndex + 1} for flat data:`, row);
    const rowData = {};
    row.forEach((item, index) => {
      const header = headers[index];
      rowData[header] = item;
    });
    data.push(rowData);
    console.log(`Flat data after row ${rowIndex + 1}:`, rowData);
  });
  return data;
}

function processNestedJSON(headers, rawRows) {
  const nestedData = {};

  rawRows.forEach((row, rowIndex) => {
    console.log(`Processing row ${rowIndex + 1} for nested data:`, row);
    row.forEach((item, index) => {
      const header = headers[index];
      if (header.includes("[")) {
        parseBracketNotation(nestedData, header, item);
      } else if (header.includes(".")) {
        setNestedObj(nestedData, header, item);
      }
    });
    console.log(`Nested data after row ${rowIndex + 1}:`, nestedData);
  });

  const cleanedData = removeEmptyKeys(nestedData);
  console.log("Cleaned Nested Data:", cleanedData);
  return [cleanedData];
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
