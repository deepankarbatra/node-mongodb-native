import { OperationBase } from './operation';
import { BulkWriteOperation } from './bulk_write';
import { MongoError } from '../error';
import { prepareDocs } from './common_functions';
import { Callback, deepFreeze } from '../utils';
import type { Collection } from '../collection';
import { ObjectId, Document, resolveBSONOptions } from '../bson';
import type { BulkWriteResult, BulkWriteOptions } from '../bulk/common';
import type { Server } from '../sdam/server';

/** @public */
export interface InsertManyResult {
  /** The total amount of documents inserted. */
  insertedCount: number;
  /** Map of the index of the inserted document to the id of the inserted document. */
  insertedIds: { [key: number]: ObjectId };
  /** All the documents inserted using insertOne/insertMany/replaceOne. Documents contain the _id field if forceServerObjectId == false for insertOne/insertMany */
  ops: Document[];
  /** The raw command result object returned from MongoDB (content might vary by server version). */
  result: Document;
}

/** @internal */
export class InsertManyOperation extends OperationBase<BulkWriteOptions, InsertManyResult> {
  collection: Collection;
  docs: Document[];

  private bypassDocumentValidation;
  private ordered;
  private forceServerObjectId;

  get builtOptions(): BulkWriteOptions {
    return deepFreeze({
      ...super.builtOptions,
      bypassDocumentValidation: this.bypassDocumentValidation,
      ordered: this.ordered,
      forceServerObjectId: this.forceServerObjectId
    });
  }

  constructor(collection: Collection, docs: Document[], options: BulkWriteOptions) {
    super(options);

    this.collection = collection;
    this.docs = docs;

    // Assign BSON serialize options to OperationBase, preferring options over collection options
    this.bsonOptions = resolveBSONOptions(options, collection);
    this.bypassDocumentValidation = options.bypassDocumentValidation;
    this.ordered = options.ordered ?? !options.keepGoing;
    this.forceServerObjectId = options.forceServerObjectId;
  }

  execute(server: Server, callback: Callback<InsertManyResult>): void {
    const coll = this.collection;
    let docs = this.docs;

    if (!Array.isArray(docs)) {
      return callback(new MongoError('docs parameter must be an array of documents'));
    }

    const options = {
      ...this.builtOptions,
      serializeFunctions: this.builtOptions.serializeFunctions || coll.s.bsonOptions.serializeFunctions
    };

    docs = prepareDocs(coll, docs, options);
    // If keep going set unordered

    // Generate the bulk write operations
    const operations = [{ insertMany: docs }];
    const bulkWriteOperation = new BulkWriteOperation(coll, operations, options);

    bulkWriteOperation.execute(server, (err, result) => {
      if (err || !result) return callback(err);
      callback(undefined, mapInsertManyResults(docs, result));
    });
  }
}

function mapInsertManyResults(docs: Document[], r: BulkWriteResult): InsertManyResult {
  const finalResult: InsertManyResult = {
    result: { ok: 1, n: r.insertedCount },
    ops: docs,
    insertedCount: r.insertedCount,
    insertedIds: r.insertedIds
  };

  if (r.getLastOp()) {
    finalResult.result.opTime = r.getLastOp();
  }

  return finalResult;
}