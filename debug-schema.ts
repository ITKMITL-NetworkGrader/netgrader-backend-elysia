import { SchemaReaderService } from "./src/services/schema-reader-service";
import fs from "fs";

async function run() {
    const spec = await SchemaReaderService.loadCombinedSchema();
    const partsPost = spec.paths["/v0/parts"]["post"];
    console.log(JSON.stringify(partsPost.requestBody.content['application/json'].schema, null, 2));
}

run();
